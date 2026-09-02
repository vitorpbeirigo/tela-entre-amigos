// Trystero owns and caches receiver tracks across room re-entry. Playback must
// stop only its own clones, otherwise the cache returns permanently ended tracks.
export function createPlaybackStream(source: MediaStream) {
  const stream = new MediaStream();
  const clones = new Map<MediaStreamTrack, MediaStreamTrack>();
  const add = (track: MediaStreamTrack) => {
    if (clones.has(track)) return;
    const clone = track.clone();
    clones.set(track, clone);
    stream.addTrack(clone);
  };
  const onAdd = (event: MediaStreamTrackEvent) => add(event.track);
  const onRemove = (event: MediaStreamTrackEvent) => {
    const clone = clones.get(event.track);
    if (!clone) return;
    stream.removeTrack(clone);
    clone.stop();
    clones.delete(event.track);
  };
  source.getTracks().forEach(add);
  source.addEventListener("addtrack", onAdd);
  source.addEventListener("removetrack", onRemove);
  return { stream, dispose: () => {
    source.removeEventListener("addtrack", onAdd);
    source.removeEventListener("removetrack", onRemove);
    clones.forEach((track) => track.stop());
    clones.clear();
  } };
}
