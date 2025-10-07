# Customizing Your 3D Scene

This documentation explains how to replace the default .vv files with your own 3D models and configure the camera parameters for optimal window mode experience.

## Table of Contents

- [Converting 3D Models to .vv Format](#converting-3d-models-to-vv-format)
- [Replacing .vv Files](#replacing-vv-files)
- [Camera Configuration Parameters](#camera-configuration-parameters)
- [Understanding the Portal Effect](#understanding-the-portal-effect)

## Converting 3D Models to .vv Format

### GLB to VV Converter

The easiest way to convert your 3D models is using the official GLB to VV converter:

**[Convert GLB to VV →](https://www.splats.com/tools/voxelize)**

**Requirements:**
- **File format**: GLB files only
- **File size limit**: 500MB maximum
- **Model type**: Static 3D models (no animations)

**Process:**
1. Upload your GLB file to the converter
2. Wait for conversion to complete
3. Download the generated .vv file


## Replacing .vv Files

The demo uses two .vv files for different orientations:

- `public/target_visualization.vv` - Desktop/landscape version
- `public/target_visualization_mobile.vv` - Mobile/portrait version

### Steps to Replace:

1. **Convert your 3D model** to .vv format using the converter above
2. **Replace the existing files** in the `public/` directory:
   ```bash
   # Replace desktop version
   cp your_model.vv public/target_visualization.vv
   
   # Replace mobile version (optional - can use same file)
   cp your_model.vv public/target_visualization_mobile.vv
   ```
3. **Restart the development server** to see changes

### File Path Configuration

If you want to use different file names, update the paths in `components/WindowModeDemoPage.tsx`:

```typescript
const vvUrl = isPortrait
  ? "/your_mobile_model.vv"    // Change this
  : "/your_desktop_model.vv";  // Change this
```

## Camera Configuration Parameters

These parameters control how the 3D scene responds to your head movement. Modify them in `components/WindowModeDemoPage.tsx`:

### WORLD_TO_VOXEL_SCALE

```typescript
const WORLD_TO_VOXEL_SCALE = 0.0075;
```

**Purpose**: Converts real-world units (centimeters) to voxel space units.

**Effect**: 
- **Higher values** = More exaggerated head movement response
- **Lower values** = Subtler head movement response

**Typical range**: 0.001 - 0.02

### SCREEN_SCALE

```typescript
const SCREEN_SCALE = 0.2 * 1.684;
```

**Purpose**: Determines how large the "window" appears in virtual space.

**Effect**:
- **Higher values** = Larger window, more immersive effect
- **Lower values** = Smaller window, more focused view

**Typical range**: 0.1 - 0.5

### SCREEN_POSITION

```typescript
const SCREEN_POSITION = [0.0, 0.0, -0.5];
```

**Purpose**: Where the screen is positioned in 3D voxel space.

**Format**: `[x, y, z]` coordinates

**Effect**:
- **X axis**: Left/right screen position
- **Y axis**: Up/down screen position  
- **Z axis**: Forward/back screen position (negative = closer to viewer)

**Typical range**: 
- X: -1.0 to 1.0
- Y: -1.0 to 1.0
- Z: -2.0 to 0.0

### SCREEN_TARGET

```typescript
const SCREEN_TARGET = [0.0, 0.0, 0.0];
```

**Purpose**: Where the screen is looking towards in 3D space.

**Format**: `[x, y, z]` coordinates

**Effect**: Controls the initial viewing direction of your 3D scene.

**Common values**:
- `[0.0, 0.0, 0.0]` - Looking at the center
- `[0.0, 0.0, 1.0]` - Looking forward
- `[0.0, 1.0, 0.0]` - Looking up

## Understanding the Portal Effect

The window mode creates a "portal" effect by using an **off-axis projection matrix**. This technique:

1. **Tracks your head position** relative to the screen
2. **Calculates your eye position** in 3D space
3. **Renders the scene** from your eye's perspective
4. **Creates the illusion** that the 3D scene exists behind the screen

### Camera Position Calculation

The system automatically calculates your eye position using:

```typescript
// Your eye position is calculated from head tracking
let avgPos = [
  (irisPosRight.x + irisPosLeft.x) / 2.0,
  (irisPosRight.y + irisPosLeft.y) / 2.0,
  (irisPosRight.z + irisPosLeft.z) / 2.0
];

// Applied to the camera
(vvRef.current as any).setCamera('portal', {
  eyePosWorld: avgPos,           // Your calculated eye position
  screenScale: SCREEN_SCALE,     // Window size
  worldToVoxelScale: WORLD_TO_VOXEL_SCALE,  // Movement sensitivity
  screenPos: SCREEN_POSITION,    // Screen location in 3D space
  screenTarget: SCREEN_TARGET    // Screen viewing direction
});
```

### Optimization Tips

- **Start with default values** and adjust gradually
- **Test with different head positions** to ensure smooth tracking
- **Consider your 3D model's scale** when setting WORLD_TO_VOXEL_SCALE
- **Adjust SCREEN_POSITION** to center your model in the viewport

---

*For general project information, see the [README](../README.md).*
