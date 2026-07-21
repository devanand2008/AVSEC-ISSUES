import React, { useState, useCallback } from 'react';
import { QrCameraView } from './QrCameraView';
import { QrPermissionState } from './QrPermissionState';

interface QrScannerPageProps {
  onResult: (decodedText: string) => void;
  title?: string;
}

export const QrScannerPage: React.FC<QrScannerPageProps> = ({ 
  onResult,
  title = "Scan QR Code"
}) => {
  const [error, setError] = useState<Error | null>(null);
  const [hasScanned, setHasScanned] = useState(false);

  const handleScanSuccess = useCallback((decodedText: string) => {
    if (!hasScanned) {
      setHasScanned(true);
      onResult(decodedText);
    }
  }, [hasScanned, onResult]);

  const handleCameraError = useCallback((err: Error) => {
    setError(err);
  }, []);

  const handleRetry = () => {
    setError(null);
    setHasScanned(false);
  };

  return (
    <div className="w-full max-w-lg mx-auto p-4 sm:p-6 space-y-6">
      <div className="text-center space-y-2">
        <h2 className="text-2xl font-bold tracking-tight text-gray-900 dark:text-gray-100">
          {title}
        </h2>
        <p className="text-gray-500 dark:text-gray-400">
          Position the QR code within the frame to scan automatically.
        </p>
      </div>

      <div className="relative rounded-2xl overflow-hidden bg-gray-100 dark:bg-gray-900 shadow-inner min-h-[300px] flex items-center justify-center">
        {error ? (
          <QrPermissionState error={error} onRetry={handleRetry} />
        ) : (
          <QrCameraView 
            onScanSuccess={handleScanSuccess}
            onError={handleCameraError}
            pause={hasScanned}
          />
        )}
      </div>
      
      {hasScanned && !error && (
        <div className="text-center p-3 bg-green-50 dark:bg-green-900/30 text-green-600 dark:text-green-400 rounded-lg animate-in fade-in zoom-in duration-300">
          <p className="font-medium">Scan successful!</p>
        </div>
      )}
    </div>
  );
};
