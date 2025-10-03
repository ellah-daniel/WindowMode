'use client';

import { useEffect, useRef, useState } from 'react';
import { ScanFace } from 'lucide-react';

// -------------------------------------------------- //

/**
 * a 2D coordinate
 */
type Pt = { x: number; y: number };

/**
 * 2D landmarks corresponding to a single iris, in image coordinates
 */
type Iris = {
  center: Pt,
  edges: Pt[]
};

/**
 * a typical laptop webcam FOV
 * TODO: can we query this?
 */
const DEFAULT_HFOV_DEG = 60;

/**
 * these values get passed to spatial-player and determine
 * how exagerrated the scene moves with your head
 * 
 * - worldToVoxelScale converts world-space units (cm, ft, etc) to voxels
 * - screenScale determines how large the "window" is in virtual space. The voxel volume always occupies [(-1,-1,-1), (1,1,1)]
 */
const WORLD_TO_VOXEL_SCALE = 0.0075;
const SCREEN_SCALE = 0.2 * 1.684;

/**
 * the FaceLandmarker indices for the left and right irises
 * from https://github.com/google-ai-edge/mediapipe/blob/master/docs/solutions/iris.md#ml-pipeline
 */
const RIGHT_IRIS_IDX = 468;
const LEFT_IRIS_IDX = 473;

// -------------------------------------------------- //

export default function WindowModeDemoPage() {

  // ------------------ //
  // STATE:

  const isPortrait = useIsPortrait();
  const isWebGPUSupported = (navigator as any).gpu != null;
  const vvUrl = isPortrait
    ? "/target_visualization_mobile.vv"
    : "/target_visualization.vv";

  const [error, setError] = useState<string | null>(null);
  const [numFramesFaceHidden, setNumFramesFaceHidden] = useState(0);
  const [hasPermission, setHasPermission] = useState<boolean>(false);
  const [isRequestingPermission, setIsRequestingPermission] = useState<boolean>(false);
  const [showTiltInstruction, setShowTiltInstruction] = useState<boolean>(false);

  const vvRef = useRef<HTMLDivElement | null>(null);
  const videoRef  = useRef<HTMLVideoElement | null>(null);

  const irisDistRightRef = useRef<number | null>(null);
  const irisDistLeftRef  = useRef<number | null>(null);

  const isPortraitRef = useRef(isPortrait);
  const numFramesFaceHiddenRef = useRef(numFramesFaceHidden);

  // ------------------ //
  // UTILITY FUNCTION:

  /**
   * sets a cookie
   */
  const setCookie = (name: string, value: string, days: number = 365) => {
    const expires = new Date();
    expires.setTime(expires.getTime() + (days * 24 * 60 * 60 * 1000));
    document.cookie = `${name}=${value};expires=${expires.toUTCString()};path=/;SameSite=Lax`;
  };

  /**
   * retrieves a cookie
   */
  const getCookie = (name: string): string | null => {
    const nameEQ = name + "=";
    const ca = document.cookie.split(';');
    for (let i = 0; i < ca.length; i++) {
      let c = ca[i];
      while (c.charAt(0) === ' ') c = c.substring(1, c.length);
      if (c.indexOf(nameEQ) === 0) return c.substring(nameEQ.length, c.length);
    }

    return null;
  };

  /**
   * request and caches camera permissions
   */
  const requestCameraPermission = async () => {
    setIsRequestingPermission(true);
    
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: "user",
          width: { ideal: 160 },
          height: { ideal: 120 }
        },
        audio: false
      });
      
      // Stop the stream immediately after getting permission
      stream.getTracks().forEach(track => track.stop());
      
      // Save permission to cookie for future visits
      setCookie('camera_permission_granted', 'true', 365);
      setHasPermission(true);
      
    } catch (e: any) {
      console.error('Camera permission denied:', e);
      setError('Camera access is required for this experience. Please allow camera access and refresh the page.');
      
    } finally {
      setIsRequestingPermission(false);
    }
  };

  /**
   * returns the focal length given the horizontal FOV
   */
  const focalLengthPixels = (imageWidthPx: number, hFovDeg: number) => {
    const a = (hFovDeg * Math.PI) / 180;
    return imageWidthPx / (2 * Math.tan(a / 2));
  }

  // ------------------ //
  // useEffects:

  /**
   * imports spatial-player
   * spatial-player uses top-level async/await so we need to import dynamically
   * 
   * TODO: fix this jank
   */
  useEffect(() => {
    // @ts-ignore
    import('spatial-player/src/index.js')
  }, []);

  /**
   * updates isPortraitRef
   */
  useEffect(() => {
    isPortraitRef.current = isPortrait;
  }, [isPortrait]);

  /**
   * checks for existing 
   */
  useEffect(() => {
    const savedPermission = getCookie('camera_permission_granted');
    if (savedPermission === 'true') {
      setHasPermission(true);
    }
  }, []);

  /**
   * shows instructions
   */
  useEffect(() => {
    if (!hasPermission) return;
    
    setShowTiltInstruction(true);
    
    const hideTiltInstructionTimer = setTimeout(() => {
      setShowTiltInstruction(false);
    }, 3000); // 3 seconds

    return () => {
      clearTimeout(hideTiltInstructionTimer);
    };
  }, [hasPermission]);

  /**
   * updates numFramesFaceHiddenRef
   */
  useEffect(() => {
    numFramesFaceHiddenRef.current = numFramesFaceHidden;
  }, [numFramesFaceHidden]);

  /**
   * main initialization + loop
   */
  useEffect(() => {
    if (!hasPermission) return;

    let running = true;
    let worker: Worker;

    async function init() {
      try {

        //get camera:
        //-----------------
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: "user",
            width: { ideal: 160 },
            height: { ideal: 120 }
          },
          audio: false
        });
        const video = videoRef.current!;
        video.srcObject = stream;
        await video.play();

        //spawn facelandmarker worker:
        //we do landmarking in a worker so we don't block rendering on the main thread
        //-----------------
        worker = new Worker(new URL('./LandmarkWorker.tsx', import.meta.url), {
          type: 'module'
        });

        worker.postMessage({
          type: 'init',
          payload: {
            wasmPath: 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm',
            modelPath: 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task'
          }
        });

        let lastTime = -1;

        let landmarkingReady = false;
        let landmarkingInFlight = false;
        let lastVideoTime = -1;
        let latestLandmarks: any[] | null = null;

        worker.onmessage = (e) => {
          if (e.data.type === 'landmarks') {
            latestLandmarks = e.data.payload?.[0] ?? null;
            landmarkingInFlight = false;

            if(latestLandmarks)
              setNumFramesFaceHidden(0);
            else
              setNumFramesFaceHidden(numFramesFaceHiddenRef.current + 1);
          }

          if(e.data.type === 'ready')
            landmarkingReady = true;
        };

        //define helpers:
        //-----------------

        //reads an iris from the mediapipe landmarks
        function extractIris(landmarks: any[], idx: number): Iris {
          let edges = [];
          for (let i = 0; i < 4; i++) {
            let landmark = landmarks[idx + 1 + i];
            edges.push({ x: landmark.x, y: landmark.y });
          }

          return {
            center: { x: landmarks[idx].x, y: landmarks[idx].y },
            edges
          };
        }

        //computes the distance from the webcam to the iris
        //uses the fact that the human iris has a relatively fixed size, regardless of age/genetics
        function irisDistance(iris: Iris, hFovDeg = DEFAULT_HFOV_DEG): number {
          const IRIS_DIAMETER_MM = 11.7; //average human iris size

          let dx = ((iris.edges[0].x - iris.edges[2].x) + (iris.edges[1].x - iris.edges[3].x)) 
            / 2.0 * video.videoWidth;
          let dy = ((iris.edges[0].y - iris.edges[2].y) + (iris.edges[1].y - iris.edges[3].y)) 
            / 2.0 * video.videoHeight;

          let irisSize = Math.sqrt(dx * dx + dy * dy);

          const fpx = focalLengthPixels(video.videoWidth, hFovDeg);

          const irisDiamCm = IRIS_DIAMETER_MM / 10;
          return (fpx * irisDiamCm) / irisSize;
        }

        //uses the distance + screen position of the iris to compute its metric position, relative to the webcam
        function irisPosition(iris: Iris, distanceCm: number, hFovDeg = DEFAULT_HFOV_DEG): { x: number; y: number; z: number } {
          const W = video.videoWidth;
          const H = video.videoHeight;

          const fpx = focalLengthPixels(W, hFovDeg);

          const u = iris.center.x;
          const v = iris.center.y;

          const x = -(u * W - W / 2) * distanceCm / fpx;
          const y = -(v * H - H / 2) * distanceCm / fpx;
          const z = distanceCm;

          return { x, y, z };
        }

        //define main loop: 
        //-----------------
        function loop() {
          if (!running)
            return;

          const currentTime = performance.now();
          const dt = currentTime - lastTime;

          lastTime = currentTime;

          //send video frame to worker
          if(landmarkingReady && !landmarkingInFlight && video.currentTime !== lastVideoTime) {
            const videoTimestamp = Math.round(video.currentTime * 1000);
            createImageBitmap(video).then((bitmap) => {
              worker.postMessage({ type: 'frame', payload: { bitmap, timestamp: videoTimestamp } }, [bitmap]);
            });

            landmarkingInFlight = true;
            lastVideoTime = video.currentTime;
          }

          if (latestLandmarks) {

            //extract irises
            const irisRight = extractIris(latestLandmarks, RIGHT_IRIS_IDX);
            const irisLeft = extractIris(latestLandmarks, LEFT_IRIS_IDX);

            //compute distances
            
            const irisTargetDistRight = irisDistance(irisRight);
            const irisTargetDistLeft = irisDistance(irisLeft);
            
            var irisDistRight = irisDistRightRef.current;
            var irisDistLeft  = irisDistLeftRef.current;

            //update current distance
            //the distance estimation is pretty noisy, so we do this to smooth it out
            const distanceDecay = 1.0 - Math.pow(0.99, dt);

            irisDistRight = irisDistRight != null
              ? irisDistRight + (irisTargetDistRight - irisDistRight) * distanceDecay
              : irisTargetDistRight;

            irisDistLeft = irisDistLeft != null
              ? irisDistLeft + (irisTargetDistLeft - irisDistLeft) * distanceDecay
              : irisTargetDistLeft;

            irisDistRightRef.current = irisDistRight;
            irisDistLeftRef.current = irisDistLeft;

            const minDist = Math.min(irisDistLeft, irisDistRight);

            //compute positions
            let irisPosRight = irisPosition(irisRight, minDist);
            let irisPosLeft = irisPosition(irisLeft, minDist);

            //update vv camera
            //.vv (voxel volume) is out format for 3D voxel scenes
            //spatial-player has utilties for rendering them
            if (customElements.get('vv-player')) {
              let avgPos = [
                (irisPosRight.x + irisPosLeft.x) / 2.0,
                (irisPosRight.y + irisPosLeft.y) / 2.0,
                (irisPosRight.z + irisPosLeft.z) / 2.0
              ];

              //do some jank manual correction so its more aligned
              //TODO: fix this
              avgPos[1] -= isPortraitRef.current ? 30.0 : 20.0;

              //to achieve the "window" effect, we use spatial-player's builtin
              //"portal" camera mode. this computes an off-axis projection matrix, and uses that
              //to render the scene in 3D

              //spatial-player is not yet open source, but the projection matrix is computed 
              //with the standard off-axis projection formula. for an overview of this, see
              // https://en.wikibooks.org/wiki/Cg_Programming/Unity/Projection_for_Virtual_Reality

              // @ts-ignore
              vvRef.current.setCamera('portal', {
                eyePosWorld: avgPos,
                screenScale: SCREEN_SCALE,
                worldToVoxelScale: WORLD_TO_VOXEL_SCALE,

                screenPos: [0.0, 0.0, -0.5],
                screenTarget: [0.0, 0.0, 0.0]
              });
            }
          }

          requestAnimationFrame(loop);
        }

        //start main loop:
        //-----------------
        requestAnimationFrame(loop);
      }
      catch (e: any) {
        console.error(e);
        setError(e?.message ?? 'Failed to initialize');
      }
    }

    //init: 
    //-----------------
    init();

    return () => {
      running = false;
      worker?.terminate();
      const v = videoRef.current;
      const stream = v && (v.srcObject as MediaStream);
      stream?.getTracks()?.forEach(t => t.stop());
    };
  }, [hasPermission]);

  /**
   * determines whether we are in portrait or landscale
   * orientation, used to render the appropriate .vv
   * (a .vv is a voxel volume file, stores a 3D scene)
   */
  function useIsPortrait() {
    const [isPortrait, setIsPortrait] = useState(false);

    useEffect(() => {
      const checkOrientation: any = () => {
        if (typeof window !== 'undefined') {
          setIsPortrait(window.innerHeight > window.innerWidth);
        }
      };

      checkOrientation();

      window.addEventListener('resize', checkOrientation);
      return () => {
        window.removeEventListener('resize', checkOrientation);
      };
    }, []);

    return isPortrait;
  }

  // ------------------ //
  // LAYOUT:

  return (
    <main style={{ 
      // display: 'grid', fontFamily: 'system-ui, sans-serif', backgroundColor: 'white' 
      }}
      
      className="min-h-screen bg-black flex flex-col items-center justify-center">
      
      {/* Permission Request Screen */}
      {!hasPermission && (
        <div 
          className="absolute inset-0 flex flex-col items-center justify-center z-50"
          style={{
            backgroundImage: 'url(/target_demo.png)',
            backgroundSize: 'cover',
            backgroundPosition: 'center',
            backgroundRepeat: 'no-repeat'
          }}
        >
          {/* Faded overlay */}
          <div className="absolute inset-0 bg-black/70"></div>
          <div className="relative z-10 max-w-md mx-auto text-center px-6">
            {/* ScanFace Icon */}
            <div className="mb-8">
              <div className="w-24 h-24 mx-auto bg-white/10 rounded-full flex items-center justify-center backdrop-blur-sm border border-white/20">
                <ScanFace className="w-12 h-12 text-white" />
              </div>
            </div>

            {/* Title */}
            <h1 className="text-3xl font-bold text-white mb-4">
              3D Viewer Demo
            </h1>

            {/* Description */}
            <p className="text-lg text-gray-300 mb-8 leading-relaxed">
            We use head tracking to enhance this experience. It allows the 3D scene to react naturally to your movements. Try tilting your head to see how the perspective shifts. It is designed for a single viewer.</p>

            {/* Permission Button */}
            <button
              onClick={requestCameraPermission}
              disabled={isRequestingPermission}
              className="w-full bg-white text-black font-semibold py-4 px-8 rounded-lg hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200 text-lg"
            >
              {isRequestingPermission ? (
                <div className="flex items-center justify-center gap-3">
                  <div className="w-5 h-5 border-2 border-black border-t-transparent rounded-full animate-spin"></div>
                  Requesting Access...
                </div>
              ) : (
                'Allow Camera Access'
              )}
            </button>

            {/* Privacy Note */}
            <p className="text-sm text-gray-400 mt-6 leading-relaxed">
              Your data is processed locally on your device and is not stored or transmitted anywhere.
            </p>
          </div>
        </div>
      )}

      {/* Main content - only show when permission is granted */}
      {hasPermission && (
        <>
          {/* Information icon with tooltip */}
          <div className="absolute top-4 left-4 z-50">
        <div className="relative group">
          <div className="w-8 h-8 bg-black/60 hover:bg-black/80 text-white rounded-full flex items-center justify-center cursor-help transition-colors duration-200 backdrop-blur-sm border border-white/20">
            <span className="text-lg font-bold italic">i</span>
          </div>
          
          {/* Tooltip */}
          <div className="absolute left-10 top-0 w-80 bg-black/90 text-white p-4 rounded-lg text-sm opacity-0 group-hover:opacity-100 transition-opacity duration-200 pointer-events-none backdrop-blur-sm border border-white/20 shadow-lg">
            <div className="font-semibold mb-2">3D Viewer Demo</div>
            <div className="text-gray-200 leading-relaxed">
            This demo uses your camera to track your head in real time. We map your head position to 3D camera controls so the video feels immersive and responsive. It is designed and recommended for a single viewer.            </div>
          </div>
        </div>
      </div>

      <div style={{ position: 'relative', width: 'min(100%, 720px)' }}>
        <video ref={videoRef} playsInline muted style={{ width: '100%', height: 'auto' }} className='hidden' />
      </div>

      <div
        className="w-full h-full bg-black flex items-center justify-center border-4 rounded-lg"
        style={{ borderColor: "#333" }}
      >
        <div className={`relative bg-black rounded-lg overflow-hidden ${isPortrait ? 'aspect-[9/16]' : 'aspect-[16/9]'}`} style={{ width: '100%', height: '100%', maxWidth: '100vw', maxHeight: '100vh' }}>
          {!isWebGPUSupported ? (
            // WebGPU not supported - show error message
            <div className="flex items-center justify-center w-full h-full">
              <div
                style={{
                  position: 'absolute',
                  top: '50%',
                  left: '50%',
                  transform: 'translate(-50%, -50%)',
                  padding: '1.5rem 3rem',
                  backgroundColor: 'rgba(0, 0, 0, 0.85)',
                  border: '2px solid rgba(112, 112, 112, 0.5)',
                  borderRadius: '12px',
                  color: 'white',
                  fontFamily: 'PixelFont',
                  fontSize: '2rem',
                  fontWeight: 700,
                  textAlign: 'center',
                  textShadow: '0 0 8px rgba(0,0,0,0.6)',
                  pointerEvents: 'none',
                }}
              >
                WebGPU is not supported on your browser
              </div>
            </div>
          ) : (
            // WebGPU supported - show the player
            <>
              {/* @ts-ignore */}
              <vv-player
                ref={vvRef}
                src={vvUrl}
                bounding-box="hide"
                top-color="0 0 0 1"
                bot-color="0 0 0 1"
                video-controls="hide"
                style={{ width: '100%', height: '100%', display: 'block' }}
              />
            </>
          )}
        </div>
      </div>

      {numFramesFaceHidden > 3 && (
        <>
          {/* Red edge overlay */}
          <div
            style={{
              position: 'absolute',
              inset: 0,
              pointerEvents: 'none',
              borderRadius: 'inherit',
              background: `
                linear-gradient(to bottom, rgba(255, 100, 103, 0.2) 0%, transparent 100%) top,
                linear-gradient(to top,    rgba(255, 100, 103, 0.2) 0%, transparent 100%) bottom,
                linear-gradient(to right,  rgba(255, 100, 103, 0.2) 0%, transparent 100%) left,
                linear-gradient(to left,   rgba(255, 100, 103, 0.2) 0%, transparent 100%) right
              `,
              backgroundRepeat: 'no-repeat',
              backgroundSize: `${window.innerWidth}px ${window.innerHeight * 0.2}px, 
                              ${window.innerWidth}px ${window.innerHeight * 0.2}px, 
                              ${window.innerWidth * 0.2}px ${window.innerHeight}px, 
                              ${window.innerWidth * 0.2}px ${window.innerHeight}px`,
              transition: 'opacity 0.3s',
            }}
          />

          <div
            style={{
              position: 'absolute',
              top: '50%',
              left: '50%',
              transform: 'translate(-50%, -50%)',
              padding: '1.5rem 3rem',
              backgroundColor: 'rgba(0, 0, 0, 0.85)',
              border: '2px solid rgba(112, 112, 112, 0.5)',
              borderRadius: '12px',
              color: 'white',
              fontFamily: 'PixelFont',
              fontSize: '2rem',
              fontWeight: 700,
              textAlign: 'center',
              textShadow: '0 0 8px rgba(0,0,0,0.6)',
              pointerEvents: 'none',
            }}
          >
            CAN&apos;T FIND USER
            <div
              style={{
                marginTop: '0.5rem',
                fontSize: '1.2rem',
                fontWeight: 400,
                color: 'rgba(255,255,255,0.9)',
              }}
            >
              Please center your face in the camera frame
            </div>
          </div>
        </>
      )}
      
      {/* Tilt instruction popup - dismisses on head movement or after 8s */}
      {showTiltInstruction && isWebGPUSupported && (
        <div className="absolute inset-0 z-50 flex items-end justify-center pb-16 pointer-events-none">
          <div className="bg-white/10 text-white px-6 py-4 rounded-xl text-lg font-medium backdrop-blur-md border border-white/30 shadow-lg transition-opacity duration-500">
            <span>Tilt your head</span>
          </div>
        </div>
      )}
      
      {error && <div style={{ color: 'crimson' }}>{error}</div>}
        </>
      )}
    </main>
  );
}