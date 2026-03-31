declare module "pannellum" {
  interface Viewer {
    destroy(): void;
    setPitch(pitch: number, animated?: boolean): void;
    setYaw(yaw: number, animated?: boolean): void;
    getPitch(): number;
    getYaw(): number;
    getHfov(): number;
    setHfov(hfov: number, animated?: boolean): void;
    resize(): void;
  }

  interface MultiResConfig {
    path: string;
    extension: string;
    tileResolution: number;
    maxLevel: number;
    cubeResolution: number;
    fallbackPath?: string;
  }

  interface Config {
    type: "equirectangular" | "multires" | "cubemap";
    // equirectangular
    panorama?: string;
    // multires
    multiRes?: MultiResConfig;
    // common
    autoLoad?: boolean;
    showControls?: boolean;
    compass?: boolean;
    hfov?: number;
    minHfov?: number;
    maxHfov?: number;
    pitch?: number;
    yaw?: number;
    friction?: number;
    mouseZoom?: boolean;
    draggable?: boolean;
    disableKeyboardCtrl?: boolean;
    [key: string]: unknown;
  }

  const pannellum: {
    viewer(container: HTMLElement, config: Config): Viewer;
  };

  export default pannellum;
}
