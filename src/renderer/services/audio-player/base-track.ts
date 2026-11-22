export abstract class BaseAudioTrack {
  protected gainNodes: GainNode[];

  private _volume: number = 1;

  duration: number;

  constructor(
    public buffers: AudioBuffer[],
    public name: string,
    public context: AudioContext,
    destination: AudioNode = context.destination,
  ) {
    this.gainNodes = Array.from({ length: buffers.length }, () => {
      const gainNode = context.createGain();

      gainNode.connect(destination);

      return gainNode;
    });
    this.duration = Math.max(
      0,
      ...this.buffers.map((buffer) => buffer.duration),
    );
  }

  get volume() {
    return this._volume;
  }

  /** `fadeSeconds` > 0 glides to the new volume instead of jumping (no click). */
  setVolume(newVolume: number, fadeSeconds = 0) {
    this._volume = newVolume;
    this.gainNodes.forEach((gainNode) => {
      const now = this.context.currentTime;

      if (fadeSeconds > 0) {
        gainNode.gain.cancelScheduledValues(now);
        gainNode.gain.setValueAtTime(gainNode.gain.value, now);
        gainNode.gain.linearRampToValueAtTime(newVolume, now + fadeSeconds);
      } else {
        gainNode.gain.setValueAtTime(newVolume, now);
      }
    });
  }

  abstract stop(): void;

  destroy() {
    this.stop();
    this.gainNodes.forEach((node) => {
      node.disconnect();
    });
    this.gainNodes = [];
  }
}
