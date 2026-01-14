import { useEffect, useState } from "react";
import { LaunchWindow } from "./components/launch/LaunchWindow";
import { SourceSelector } from "./components/launch/SourceSelector";
import VideoEditor from "./components/video-editor/VideoEditor";
import { CameraOverlayWindow } from "./components/camera-overlay-window";

export default function App() {
  const [windowType, setWindowType] = useState('');

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const type = params.get('windowType') || '';
    setWindowType(type);
    if (type === 'hud-overlay' || type === 'source-selector') {
      document.body.style.background = 'transparent';
      document.documentElement.style.background = 'transparent';
      document.getElementById('root')?.style.setProperty('background', 'transparent');
      // Ensure full window height is used for HUD
      if (type === 'hud-overlay') {
        document.documentElement.style.height = '100%';
        document.body.style.height = '100%';
        document.getElementById('root')?.style.setProperty('height', '100%');
        document.body.style.overflow = 'visible';
      }
    }
  }, []);

  switch (windowType) {
    case 'hud-overlay':
      return <LaunchWindow />;
    case 'source-selector':
      return <SourceSelector />;
    case 'editor':
      return <VideoEditor />;
    case 'camera-overlay':
      return <CameraOverlayWindow />;
    default:
      return (
        <div className="w-full h-full bg-background text-foreground">
          <h1>Openscreen</h1>
        </div>
      );
  }
}
