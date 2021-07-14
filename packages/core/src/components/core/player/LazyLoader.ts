import { IS_CLIENT } from '../../../utils/support';
import { isNil } from '../../../utils/unit';

export class LazyLoader {
  private intersectionObs?: IntersectionObserver;

  private mutationObs?: MutationObserver;

  private hasLoaded = false;

  constructor(
    private el: HTMLElement,
    private attributes: string[],
    private onLoad?: (el: HTMLElement) => void,
  ) {
    if (isNil(this.el)) return;

    this.intersectionObs = this.canObserveIntersection()
      ? new IntersectionObserver(this.onIntersection.bind(this))
      : undefined;

    this.mutationObs = this.canObserveMutations()
      ? new MutationObserver(this.onMutation.bind(this))
      : undefined;

    this.mutationObs?.observe(this.el, {
      childList: true,
      subtree: true,
      attributeFilter: this.attributes,
    });

    this.lazyLoad();
  }

  didLoad() {
    return this.hasLoaded;
  }

  destroy() {
    this.intersectionObs?.disconnect();
    this.mutationObs?.disconnect();
  }

  private canObserveIntersection() {
    return IS_CLIENT && window.IntersectionObserver;
  }

  private canObserveMutations() {
    return IS_CLIENT && window.MutationObserver;
  }

  private isPartiallyVisible(el: Element) {
    const rect = el.getBoundingClientRect();
    const windowHeight =
      window.innerHeight || document.documentElement.clientHeight;
    const windowWidth =
      window.innerWidth || document.documentElement.clientWidth;

    const verticallyInView =
      rect.top <= windowHeight && rect.top + rect.height >= 0;
    const horizontallyInView =
      rect.left <= windowWidth && rect.left + rect.width >= 0;

    return verticallyInView && horizontallyInView;
  }

  private lazyLoad() {
    if (this.intersectionObs) {
      if (this.isPartiallyVisible(this.el)) {
        this.load();
      } else {
        this.intersectionObs.observe(this.el);
      }
    } else {
      this.load();
    }
  }

  private onIntersection(entries: IntersectionObserverEntry[]) {
    entries.forEach(entry => {
      if (entry.intersectionRatio > 0 || entry.isIntersecting) {
        this.load();
        this.intersectionObs!.unobserve(entry.target);
      }
    });
  }

  onMutation() {
    if (this.hasLoaded) this.load();
  }

  private getLazyElements() {
    const root = !isNil(this.el.shadowRoot) ? this.el.shadowRoot : this.el;
    return root!.querySelectorAll<HTMLElement>('.lazy');
  }

  private load() {
    window.requestAnimationFrame(() => {
      this.getLazyElements().forEach(this.loadEl.bind(this));
    });
  }

  private loadEl(el: HTMLElement) {
    this.intersectionObs?.unobserve(el);
    this.hasLoaded = true;
    this.onLoad?.(el);
  }
}
