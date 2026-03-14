// Test setup for jsdom environment
// Mock ImageData for canvas operations
if (typeof globalThis.ImageData === 'undefined') {
  class MockImageData {
    data: Uint8ClampedArray;
    width: number;
    height: number;
    colorSpace: PredefinedColorSpace = 'srgb';

    constructor(dataOrWidth: Uint8ClampedArray | number, widthOrHeight?: number, height?: number) {
      if (dataOrWidth instanceof Uint8ClampedArray) {
        this.data = dataOrWidth;
        this.width = widthOrHeight!;
        this.height = height!;
      } else {
        this.width = dataOrWidth;
        this.height = widthOrHeight!;
        this.data = new Uint8ClampedArray(this.width * this.height * 4);
      }
    }
  }
  // @ts-ignore
  globalThis.ImageData = MockImageData;
}

// Mock ResizeObserver
if (typeof globalThis.ResizeObserver === 'undefined') {
  class MockResizeObserver {
    callback: ResizeObserverCallback;
    constructor(callback: ResizeObserverCallback) {
      this.callback = callback;
    }
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  // @ts-ignore
  globalThis.ResizeObserver = MockResizeObserver;
}

// Mock requestAnimationFrame / cancelAnimationFrame
if (typeof globalThis.requestAnimationFrame === 'undefined') {
  globalThis.requestAnimationFrame = (cb: FrameRequestCallback) => {
    return setTimeout(() => cb(Date.now()), 16) as unknown as number;
  };
  globalThis.cancelAnimationFrame = (id: number) => {
    clearTimeout(id);
  };
}

// Create a reusable mock 2D canvas context
const mockCtx = {
  imageSmoothingEnabled: true,
  drawImage: vi.fn(),
  putImageData: vi.fn(),
  getImageData: vi.fn(() => ({ data: new Uint8ClampedArray(4), width: 1, height: 1 })),
  fillRect: vi.fn(),
  clearRect: vi.fn(),
  beginPath: vi.fn(),
  stroke: vi.fn(),
  fill: vi.fn(),
  save: vi.fn(),
  restore: vi.fn(),
  translate: vi.fn(),
  rotate: vi.fn(),
  scale: vi.fn(),
  arc: vi.fn(),
  moveTo: vi.fn(),
  lineTo: vi.fn(),
  closePath: vi.fn(),
  setTransform: vi.fn(),
  fillStyle: '#000',
  strokeStyle: '#000',
  lineWidth: 1,
} as unknown as CanvasRenderingContext2D;

// Mock document.createElement('canvas') for components that create temporary canvases
const originalCreateElement = document.createElement.bind(document);
document.createElement = function(tagName: string, options?: ElementCreationOptions) {
  const el = originalCreateElement(tagName, options);
  if (tagName === 'canvas') {
    const canvas = el as HTMLCanvasElement;
    // Override getContext to return a mock 2d context
    const origGetContext = canvas.getContext.bind(canvas);
    canvas.getContext = function(contextId: string) {
      if (contextId === '2d') {
        return mockCtx;
      }
      return origGetContext(contextId);
    } as typeof canvas.getContext;
  }
  return el;
} as typeof document.createElement;

// Also patch HTMLCanvasElement.prototype.getContext for Svelte-rendered canvases
const origProtoGetContext = HTMLCanvasElement.prototype.getContext;
HTMLCanvasElement.prototype.getContext = function(contextId: string, options?: unknown) {
  if (contextId === '2d') {
    return mockCtx;
  }
  return origProtoGetContext.call(this, contextId as any, options);
} as typeof HTMLCanvasElement.prototype.getContext;
