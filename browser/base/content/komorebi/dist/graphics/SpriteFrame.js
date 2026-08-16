export function currentFrame(frames, timestamp, animationStart) {
    const list = frames;
    if (!list?.length) {
        return null;
    }
    const total = list.reduce((sum, frame) => sum + frame.duration, 0);
    let elapsed = ((timestamp - animationStart) / 1000) % total;
    for (const frame of list) {
        if (elapsed < frame.duration) {
            return frame;
        }
        elapsed -= frame.duration;
    }
    return list.at(-1) ?? null;
}
