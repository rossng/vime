import {
  Component,
  Event,
  EventEmitter,
  h,
  Listen,
  Method,
  Prop,
  State,
} from '@stencil/core';
import type HlsClass from 'hls.js';

import { loadSDK } from '../../../utils/network';
import { isNil, isString, isUndefined } from '../../../utils/unit';
import { MediaType } from '../../core/player/MediaType';
import { PlayerProps } from '../../core/player/PlayerProps';
import { withComponentRegistry } from '../../core/player/withComponentRegistry';
import { withPlayerContext } from '../../core/player/withPlayerContext';
import {
  MediaCrossOriginOption,
  MediaFileProvider,
  MediaPreloadOption,
} from '../file/MediaFileProvider';
import { hlsRegex, hlsTypeRegex } from '../file/utils';
import { withProviderConnect } from '../ProviderConnect';
import {
  createProviderDispatcher,
  ProviderDispatcher,
} from '../ProviderDispatcher';

/**
 * Enables loading, playing and controlling [HLS](https://en.wikipedia.org/wiki/HTTP_Live_Streaming)
 * based media. If the [browser does not support HLS](https://caniuse.com/#search=hls) then the
 * [`hls.js`](https://github.com/video-dev/hls.js) library is downloaded and used as a fallback to
 * play the stream.
 *
 * > You don't interact with this component for passing player properties, controlling playback,
 * listening to player events and so on, that is all done through the `vime-player` component.
 *
 * @slot - Pass `<source>` elements to the underlying HTML5 media player.
 */
@Component({
  tag: 'vm-hls',
})
export class HLS implements MediaFileProvider {
  private hls?: HlsClass;

  private videoProvider!: HTMLVmVideoElement;

  private mediaEl?: HTMLVideoElement;

  private dispatch!: ProviderDispatcher;

  @State() hasAttached = false;

  @State() currentLoadedUrl: string | undefined = undefined;

  /**
   * The NPM package version of the `hls.js` library to download and use if HLS is not natively
   * supported.
   */
  @Prop() version = 'latest';

  /**
   * The URL where the `hls.js` library source can be found. If this property is used, then the
   * `version` property is ignored.
   */
  @Prop() libSrc?: string;

  /**
   * The `hls.js` configuration.
   */
  @Prop({ attribute: 'config' }) config?: any;

  /** @inheritdoc */
  @Prop() crossOrigin?: MediaCrossOriginOption;

  /** @inheritdoc */
  @Prop() preload?: MediaPreloadOption = 'metadata';

  /** @inheritdoc */
  @Prop() poster?: string;

  /** @inheritdoc */
  @Prop() controlsList?: string;

  /** @inheritdoc */
  @Prop({ attribute: 'auto-pip' }) autoPiP?: boolean;

  /** @inheritdoc */
  @Prop({ attribute: 'disable-pip' }) disablePiP?: boolean;

  /** @inheritdoc */
  @Prop() disableRemotePlayback?: boolean;

  /** @internal */
  @Prop() playbackReady = false;

  /**
   * The title of the current media.
   */
  @Prop() mediaTitle?: string;

  /** @internal */
  @Event() vmLoadStart!: EventEmitter<void>;

  /**
   * Emitted when an error has occurred.
   */
  @Event() vmError!: EventEmitter<any>;

  constructor() {
    withComponentRegistry(this);
    withProviderConnect(this);
    withPlayerContext(this, ['playbackReady']);
  }

  connectedCallback() {
    this.dispatch = createProviderDispatcher(this);
    if (this.mediaEl) this.setupHls();
  }

  disconnectedCallback() {
    this.destroyHls();
  }

  get src(): string | undefined {
    if (isNil(this.videoProvider)) return undefined;
    const sources = this.videoProvider.querySelectorAll('source');
    const currSource = Array.from(sources).find(
      source => hlsRegex.test(source.src) || hlsTypeRegex.test(source.type),
    );
    return currSource?.src;
  }

  private async setupHls() {
    if (!isUndefined(this.hls)) return;

    try {
      const url =
        this.libSrc ||
        `https://cdn.jsdelivr.net/npm/hls.js@${this.version}/dist/hls.min.js`;

      const Hls = (await loadSDK(url, 'Hls')) as typeof HlsClass;

      if (!Hls.isSupported()) {
        this.vmError.emit('hls.js is not supported');
        return;
      }

      this.hls = new Hls(this.config);
      const hls = this.hls;

      this.hls.on(Hls.Events.MEDIA_ATTACHED, () => {
        if (hls !== this.hls) return;
        this.hasAttached = true;
        this.onSrcChange();
      });

      this.hls.on(Hls.Events.AUDIO_TRACKS_UPDATED, () => {
        if (hls !== this.hls) return;
        this.dispatch('audioTracks', hls.audioTracks);
        this.dispatch('currentAudioTrack', hls.audioTrack);
      });

      this.hls.on(Hls.Events.AUDIO_TRACK_SWITCHED, () => {
        if (hls !== this.hls) return;
        this.dispatch('currentAudioTrack', hls.audioTrack);
      });

      this.hls.on(Hls.Events.ERROR, (_, data) => {
        if (hls !== this.hls) return;
        if (data.fatal) {
          switch (data.type) {
            case Hls.ErrorTypes.NETWORK_ERROR:
              hls.startLoad();
              break;
            case Hls.ErrorTypes.MEDIA_ERROR:
              hls.recoverMediaError();
              break;
            default:
              this.destroyHls(hls);
              break;
          }
        }

        this.vmError.emit({ event, data });
      });

      this.hls.on(Hls.Events.MANIFEST_PARSED, () => {
        if (hls !== this.hls) return;
        this.dispatch('mediaType', MediaType.Video);
        this.dispatch('currentSrc', this.src);
        this.dispatchLevels(hls);
      });

      this.hls.on(Hls.Events.LEVEL_LOADED, (_, data) => {
        if (hls !== this.hls) return;
        if (!this.playbackReady) {
          this.dispatch('duration', data.details.totalduration);
          this.dispatch('playbackReady', true);
        }
      });

      if (this.mediaEl) {
        this.hls.attachMedia(this.mediaEl);
      } else {
        throw new Error('No mediaEl was available to attach to Hls');
      }
    } catch (e) {
      this.destroyHls();
      this.vmError.emit(e);
    }
  }

  private dispatchLevels(hls: HlsClass) {
    if (!hls.levels || hls.levels.length === 0) return;

    this.dispatch('playbackQualities', [
      'Auto',
      ...hls.levels.map(this.levelToPlaybackQuality),
    ]);

    this.dispatch('playbackQuality', 'Auto');
  }

  private levelToPlaybackQuality(level: any) {
    return level === -1 ? 'Auto' : `${level.height}p`;
  }

  private findLevelIndexFromQuality(
    hls: HlsClass,
    quality: PlayerProps['playbackQuality'],
  ) {
    return hls.levels.findIndex(
      level => this.levelToPlaybackQuality(level) === quality,
    );
  }

  private destroyHls(hls?: HlsClass) {
    const hlsToDestroy = hls ?? this.hls;
    hlsToDestroy?.destroy();
    if (hlsToDestroy === this.hls) {
      this.hasAttached = false;
      this.currentLoadedUrl = undefined;
    }
  }

  @Listen('vmMediaElChange')
  async onMediaElChange(event: CustomEvent<HTMLVideoElement | undefined>) {
    this.destroyHls();
    if (isUndefined(event.detail)) return;
    this.mediaEl = event.detail;
    // Need a small delay incase the media element changes rapidly and Hls.js can't reattach.
    setTimeout(async () => {
      await this.setupHls();
    }, 50);
  }

  @Listen('vmSrcSetChange')
  private async onSrcChange() {
    if (this.hasAttached && this.hls) {
      if (!this.src) {
        this.hls?.stopLoad();
      } else if (this.currentLoadedUrl !== this.src) {
        this.vmLoadStart.emit();
        this.hls.loadSource(this.src);
      }
      this.currentLoadedUrl = this.src;
    }
  }

  /** @internal */
  @Method()
  async getAdapter() {
    const adapter = (await this.videoProvider?.getAdapter()) ?? {};
    const canVideoProviderPlay = adapter.canPlay;
    return {
      ...adapter,
      getInternalPlayer: async () => this.hls as any,
      canPlay: async (type: any) =>
        (isString(type) && hlsRegex.test(type)) ||
        (canVideoProviderPlay?.(type) ?? false),
      canSetPlaybackQuality: async () =>
        !!this.hls && this.hls?.levels?.length > 0,
      setPlaybackQuality: async (quality: string) => {
        if (!isUndefined(this.hls)) {
          this.hls.currentLevel = this.findLevelIndexFromQuality(
            this.hls,
            quality,
          );
          // Update the provider cache.
          this.dispatch('playbackQuality', quality);
        }
      },
      setCurrentAudioTrack: async (trackId: number) => {
        if (!isUndefined(this.hls)) {
          this.hls.audioTrack = trackId;
        }
      },
    };
  }

  render() {
    return (
      <vm-video
        willAttach
        crossOrigin={this.crossOrigin}
        preload={this.preload}
        poster={this.poster}
        controlsList={this.controlsList}
        autoPiP={this.autoPiP}
        disablePiP={this.disablePiP}
        disableRemotePlayback={this.disableRemotePlayback}
        mediaTitle={this.mediaTitle}
        ref={(el: any) => {
          this.videoProvider = el;
        }}
      >
        <slot />
      </vm-video>
    );
  }
}
