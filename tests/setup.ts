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
        return {
          imageSmoothingEnabled: true,
          drawImage: vi.fn(),
          putImageData: vi.fn(),
          getImageData: vi.fn(() => ({ data: new Uint8ClampedArray(4) })),
          fillRect: vi.fn(),
          clearRect: vi.fn(),
          beginPath: vi.fn(),
          stroke: vi.fn(),
          fill: vi.fn(),
        } as unknown as CanvasRenderingContext2D;
      }
      return origGetContext(contextId);
    } as typeof canvas.getContext;
  }
  return el;
} as typeof document.createElement;
