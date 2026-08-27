#include <Windows.h>
#include <TlHelp32.h>
#include <audioclient.h>
#include <audioclientactivationparams.h>
#include <fcntl.h>
#include <io.h>
#include <mmdeviceapi.h>
#include <propvarutil.h>
#include <wrl/client.h>
#include <wrl/implements.h>

#include <atomic>
#include <cstdio>
#include <cwchar>
#include <string>
#include <unordered_map>
#include <unordered_set>
#include <vector>

using Microsoft::WRL::ComPtr;
using Microsoft::WRL::FtmBase;
using Microsoft::WRL::RuntimeClass;
using Microsoft::WRL::RuntimeClassFlags;
using Microsoft::WRL::ClassicCom;

namespace {

constexpr UINT32 kSampleRate = 48'000;
constexpr WORD kChannelCount = 2;
constexpr WORD kBitsPerSample = 16;
constexpr DWORD kDiscordCheckIntervalMs = 2'000;

std::atomic_bool g_stopRequested{ false };

BOOL WINAPI ConsoleControlHandler(DWORD controlType)
{
    if (controlType == CTRL_C_EVENT || controlType == CTRL_BREAK_EVENT ||
        controlType == CTRL_CLOSE_EVENT || controlType == CTRL_SHUTDOWN_EVENT)
    {
        g_stopRequested = true;
        return TRUE;
    }
    return FALSE;
}

bool IsDiscordExecutable(const wchar_t* executable)
{
    return _wcsicmp(executable, L"Discord.exe") == 0 ||
        _wcsicmp(executable, L"DiscordCanary.exe") == 0 ||
        _wcsicmp(executable, L"DiscordPTB.exe") == 0 ||
        _wcsicmp(executable, L"DiscordDevelopment.exe") == 0;
}

DWORD FindDiscordRootProcess()
{
    HANDLE snapshot = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
    if (snapshot == INVALID_HANDLE_VALUE)
    {
        return 0;
    }

    PROCESSENTRY32W entry{};
    entry.dwSize = sizeof(entry);
    std::unordered_map<DWORD, DWORD> parents;

    if (Process32FirstW(snapshot, &entry))
    {
        do
        {
            if (IsDiscordExecutable(entry.szExeFile))
            {
                parents.emplace(entry.th32ProcessID, entry.th32ParentProcessID);
            }
        } while (Process32NextW(snapshot, &entry));
    }
    CloseHandle(snapshot);

    if (parents.empty())
    {
        return 0;
    }

    std::unordered_set<DWORD> discordPids;
    for (const auto& [pid, _] : parents)
    {
        discordPids.insert(pid);
    }

    DWORD root = 0;
    for (const auto& [pid, parentPid] : parents)
    {
        if (!discordPids.count(parentPid) && (root == 0 || pid < root))
        {
            root = pid;
        }
    }

    return root != 0 ? root : parents.begin()->first;
}

class ProcessLoopbackCapture final :
    public RuntimeClass<RuntimeClassFlags<ClassicCom>, FtmBase, IActivateAudioInterfaceCompletionHandler>
{
public:
    ProcessLoopbackCapture()
    {
        m_activationCompleted = CreateEventW(nullptr, FALSE, FALSE, nullptr);
        m_samplesReady = CreateEventW(nullptr, FALSE, FALSE, nullptr);
    }

    ~ProcessLoopbackCapture() override
    {
        Stop();
        if (m_activationCompleted) CloseHandle(m_activationCompleted);
        if (m_samplesReady) CloseHandle(m_samplesReady);
    }

    HRESULT Start(DWORD targetProcessId)
    {
        if (!m_activationCompleted || !m_samplesReady)
        {
            return HRESULT_FROM_WIN32(GetLastError());
        }

        AUDIOCLIENT_ACTIVATION_PARAMS activationParams{};
        activationParams.ActivationType = AUDIOCLIENT_ACTIVATION_TYPE_PROCESS_LOOPBACK;
        activationParams.ProcessLoopbackParams.TargetProcessId = targetProcessId;
        activationParams.ProcessLoopbackParams.ProcessLoopbackMode =
            PROCESS_LOOPBACK_MODE_EXCLUDE_TARGET_PROCESS_TREE;

        PROPVARIANT activateParams{};
        activateParams.vt = VT_BLOB;
        activateParams.blob.cbSize = sizeof(activationParams);
        activateParams.blob.pBlobData = reinterpret_cast<BYTE*>(&activationParams);

        ComPtr<IActivateAudioInterfaceAsyncOperation> operation;
        HRESULT hr = ActivateAudioInterfaceAsync(
            VIRTUAL_AUDIO_DEVICE_PROCESS_LOOPBACK,
            __uuidof(IAudioClient),
            &activateParams,
            this,
            &operation);
        if (FAILED(hr)) return hr;

        DWORD waitResult = WaitForSingleObject(m_activationCompleted, 5'000);
        if (waitResult != WAIT_OBJECT_0)
        {
            return waitResult == WAIT_TIMEOUT ? HRESULT_FROM_WIN32(ERROR_TIMEOUT) : HRESULT_FROM_WIN32(GetLastError());
        }
        if (FAILED(m_activationResult)) return m_activationResult;

        WAVEFORMATEX format{};
        format.wFormatTag = WAVE_FORMAT_PCM;
        format.nChannels = kChannelCount;
        format.nSamplesPerSec = kSampleRate;
        format.wBitsPerSample = kBitsPerSample;
        format.nBlockAlign = format.nChannels * format.wBitsPerSample / 8;
        format.nAvgBytesPerSec = format.nSamplesPerSec * format.nBlockAlign;

        hr = m_audioClient->Initialize(
            AUDCLNT_SHAREMODE_SHARED,
            AUDCLNT_STREAMFLAGS_LOOPBACK |
                AUDCLNT_STREAMFLAGS_EVENTCALLBACK |
                AUDCLNT_STREAMFLAGS_AUTOCONVERTPCM |
                AUDCLNT_STREAMFLAGS_SRC_DEFAULT_QUALITY,
            0,
            0,
            &format,
            nullptr);
        if (FAILED(hr)) return hr;

        hr = m_audioClient->GetService(IID_PPV_ARGS(&m_captureClient));
        if (FAILED(hr)) return hr;

        hr = m_audioClient->SetEventHandle(m_samplesReady);
        if (FAILED(hr)) return hr;

        hr = m_audioClient->Start();
        if (SUCCEEDED(hr)) m_started = true;
        return hr;
    }

    HRESULT DrainSamples()
    {
        UINT32 framesAvailable = 0;
        HRESULT hr = S_OK;

        while (SUCCEEDED(hr = m_captureClient->GetNextPacketSize(&framesAvailable)) && framesAvailable > 0)
        {
            BYTE* data = nullptr;
            UINT32 frames = 0;
            DWORD flags = 0;
            hr = m_captureClient->GetBuffer(&data, &frames, &flags, nullptr, nullptr);
            if (FAILED(hr)) return hr;

            const DWORD byteCount = frames * kChannelCount * (kBitsPerSample / 8);
            bool wrote = false;
            if ((flags & AUDCLNT_BUFFERFLAGS_SILENT) != 0 || data == nullptr)
            {
                std::vector<BYTE> silence(byteCount, 0);
                wrote = WriteBytes(silence.data(), byteCount);
            }
            else
            {
                wrote = WriteBytes(data, byteCount);
            }

            m_captureClient->ReleaseBuffer(frames);
            if (!wrote) return HRESULT_FROM_WIN32(ERROR_BROKEN_PIPE);
        }

        return hr;
    }

    HANDLE SamplesReadyEvent() const { return m_samplesReady; }

    void Stop()
    {
        if (m_started && m_audioClient)
        {
            m_audioClient->Stop();
            m_started = false;
        }
        m_captureClient.Reset();
        m_audioClient.Reset();
    }

    STDMETHOD(ActivateCompleted)(IActivateAudioInterfaceAsyncOperation* operation) override
    {
        HRESULT activationHr = E_UNEXPECTED;
        ComPtr<IUnknown> activatedInterface;
        HRESULT hr = operation->GetActivateResult(&activationHr, &activatedInterface);
        if (SUCCEEDED(hr)) hr = activationHr;
        if (SUCCEEDED(hr)) hr = activatedInterface.As(&m_audioClient);
        m_activationResult = hr;
        SetEvent(m_activationCompleted);
        return S_OK;
    }

private:
    static bool WriteBytes(const BYTE* bytes, DWORD count)
    {
        HANDLE output = GetStdHandle(STD_OUTPUT_HANDLE);
        while (count > 0)
        {
            DWORD written = 0;
            if (!WriteFile(output, bytes, count, &written, nullptr) || written == 0)
            {
                return false;
            }
            bytes += written;
            count -= written;
        }
        return true;
    }

    HANDLE m_activationCompleted = nullptr;
    HANDLE m_samplesReady = nullptr;
    HRESULT m_activationResult = E_UNEXPECTED;
    bool m_started = false;
    ComPtr<IAudioClient> m_audioClient;
    ComPtr<IAudioCaptureClient> m_captureClient;
};

void PrintFailure(const wchar_t* phase, HRESULT hr)
{
    fwprintf(stderr, L"ERROR %ls 0x%08lX\n", phase, static_cast<unsigned long>(hr));
    fflush(stderr);
}

} // namespace

int wmain(int argc, wchar_t* argv[])
{
    _setmode(_fileno(stdout), _O_BINARY);
    setvbuf(stdout, nullptr, _IONBF, 0);
    SetConsoleCtrlHandler(ConsoleControlHandler, TRUE);

    HRESULT hr = CoInitializeEx(nullptr, COINIT_MULTITHREADED);
    if (FAILED(hr))
    {
        PrintFailure(L"CoInitializeEx", hr);
        return 1;
    }

    HANDLE parentProcess = nullptr;
    if (argc >= 2)
    {
        const DWORD parentPid = static_cast<DWORD>(wcstoul(argv[1], nullptr, 10));
        if (parentPid != 0)
        {
            parentProcess = OpenProcess(SYNCHRONIZE, FALSE, parentPid);
        }
    }

    int exitCode = 0;
    while (!g_stopRequested)
    {
        const DWORD discordPid = FindDiscordRootProcess();
        const DWORD excludedPid = discordPid != 0 ? discordPid : GetCurrentProcessId();

        auto capture = Microsoft::WRL::Make<ProcessLoopbackCapture>();
        if (!capture)
        {
            fwprintf(stderr, L"ERROR allocation\n");
            exitCode = 1;
            break;
        }

        hr = capture->Start(excludedPid);
        if (FAILED(hr))
        {
            PrintFailure(L"capture-start", hr);
            exitCode = 1;
            break;
        }

        fwprintf(stderr, L"READY %lu\n", static_cast<unsigned long>(discordPid));
        fflush(stderr);

        DWORD lastDiscordCheck = GetTickCount();
        bool restartForDiscord = false;
        while (!g_stopRequested)
        {
            HANDLE waitHandles[] = { capture->SamplesReadyEvent(), parentProcess };
            const DWORD handleCount = parentProcess ? 2 : 1;
            const DWORD waitResult = WaitForMultipleObjects(handleCount, waitHandles, FALSE, 100);
            if (waitResult == WAIT_OBJECT_0)
            {
                hr = capture->DrainSamples();
                if (FAILED(hr))
                {
                    if (HRESULT_CODE(hr) != ERROR_BROKEN_PIPE) PrintFailure(L"capture-read", hr);
                    g_stopRequested = true;
                    exitCode = HRESULT_CODE(hr) == ERROR_BROKEN_PIPE ? 0 : 1;
                    break;
                }
            }
            else if (parentProcess && waitResult == WAIT_OBJECT_0 + 1)
            {
                g_stopRequested = true;
                break;
            }
            else if (waitResult != WAIT_TIMEOUT)
            {
                PrintFailure(L"capture-wait", HRESULT_FROM_WIN32(GetLastError()));
                exitCode = 1;
                g_stopRequested = true;
                break;
            }

            const DWORD now = GetTickCount();
            if (now - lastDiscordCheck >= kDiscordCheckIntervalMs)
            {
                lastDiscordCheck = now;
                if (FindDiscordRootProcess() != discordPid)
                {
                    restartForDiscord = true;
                    break;
                }
            }
        }

        capture->Stop();
        capture.Reset();
        if (!restartForDiscord) break;
    }

    if (parentProcess) CloseHandle(parentProcess);
    CoUninitialize();
    return exitCode;
}
