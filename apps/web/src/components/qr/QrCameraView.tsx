import React, { useEffect, useRef, useState } from 'react';
import { Html5Qrcode } from 'html5-qrcode';

interface QrCameraViewProps {
  onScanSuccess: (decodedText: string) => void;
  onScanError?: (errorMessage: string) => void;
  onError?: (error: Error) => void;
  pause?: boolean;
}

export const QrCameraView: React.FC<QrCameraViewProps> = ({
  onScanSuccess,
  onScanError,
  onError,
  pause = false,
}) => {
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const containerId = 'qr-reader';
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    let isMounted = true;
    const scanner = new Html5Qrcode(containerId);
    scannerRef.current = scanner;

    const startScanner = async () => {
      try {
        await scanner.start(
          { facingMode: 'environment' },
          {
            fps: 10,
            qrbox: { width: 250, height: 250 },
            aspectRatio: 1.0,
          },
          (decodedText) => {
            if (isMounted) onScanSuccess(decodedText);
          },
          (errorMessage) => {
            if (isMounted && onScanError) onScanError(errorMessage);
          }
        );
        if (isMounted) setIsReady(true);
      } catch (err) {
        if (isMounted && onError) {
          onError(err instanceof Error ? err : new Error(String(err)));
        }
      }
    };

    startScanner();

    return () => {
      isMounted = false;
      if (scannerRef.current) {
        // We catch errors on stop as the camera might have already been released
        scannerRef.current.stop().catch(console.error).finally(() => {
          scannerRef.current?.clear();
          scannerRef.current = null;
        });
      }
    };
  }, [onScanSuccess, onScanError, onError]);

  useEffect(() => {
    if (scannerRef.current && isReady) {
      if (pause) {
        scannerRef.current.pause();
      } else {
        scannerRef.current.resume();
      }
    }
  }, [pause, isReady]);

  return (
    <div className="w-full max-w-md mx-auto overflow-hidden rounded-xl border border-gray-200 dark:border-gray-800 bg-black">
      <div id={containerId} className="w-full" />
    </div>
  );
};
