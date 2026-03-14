declare module 'aladin-lite' {
  interface AladinInstance {
    setZoom: (level: number) => void;
    zoomIn: () => void;
    zoomOut: () => void;
    getZoom: () => number;
    gotoRaDec: (ra: number, dec: number) => void;
    getRaDec: () => [number, number];
    setImageSurvey: (survey: string | object) => void;
    setOverlayImageSurvey: (survey: string | object, opacity?: number) => void;
    removeImageSurvey: (id: string) => void;
    getBaseImageLayer: () => { id: string };
    addCatalog: (catalog: unknown) => void;
    removeCatalog: (catalog: unknown) => void;
    on: (event: string, callback: (...args: unknown[]) => void) => void;
    off: (event: string) => void;
    view: {
      canvas?: HTMLCanvasElement;
    };
  }

  interface AladinOptions {
    target?: string;
    zoom?: number;
    survey?: string;
    cooFrame?: string;
    showFullscreenControl?: boolean;
    showZoomControl?: boolean;
    showLayersControl?: boolean;
    showGotoControl?: boolean;
    showSimbadPointerControl?: boolean;
    showCooGrid?: boolean;
    showStatusBar?: boolean;
    showProjectionControl?: boolean;
  }

  interface AladinStatic {
    init: () => Promise<void>;
    aladin: (selector: string | HTMLElement, options?: AladinOptions) => AladinInstance;
    HiPS: (url: string, options?: Record<string, unknown>) => unknown;
  }

  const A: AladinStatic;
  export default A;
}
