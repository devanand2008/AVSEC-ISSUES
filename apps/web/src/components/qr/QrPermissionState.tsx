import React from 'react';
import { Camera, CameraOff, AlertTriangle } from 'lucide-react';

interface QrPermissionStateProps {
  error: Error | null;
  onRetry: () => void;
}

export const QrPermissionState: React.FC<QrPermissionStateProps> = ({ error, onRetry }) => {
  const isHttpsError =
    error?.name === 'NotAllowedError' || 
    error?.message.toLowerCase().includes('https') ||
    error?.message.toLowerCase().includes('permission');

  return (
    <div className="flex flex-col items-center justify-center p-8 text-center space-y-6 bg-white dark:bg-gray-950 rounded-2xl border border-gray-200 dark:border-gray-800 shadow-sm">
      <div className="p-4 bg-red-50 dark:bg-red-950/30 rounded-full text-red-500">
        {isHttpsError ? (
          <CameraOff className="w-12 h-12" />
        ) : (
          <AlertTriangle className="w-12 h-12" />
        )}
      </div>

      <div className="space-y-2">
        <h3 className="text-xl font-semibold text-gray-900 dark:text-gray-100">
          Camera Access Required
        </h3>
        <p className="text-gray-500 dark:text-gray-400 max-w-sm">
          {isHttpsError
            ? "We need camera permissions to scan QR codes. Ensure you are on HTTPS (or localhost) and have granted camera permissions in your browser settings."
            : error?.message || "An unexpected error occurred while accessing the camera."}
        </p>
      </div>

      <button
        onClick={onRetry}
        className="flex items-center px-6 py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg transition-colors focus:ring-4 focus:ring-blue-500/20"
      >
        <Camera className="w-4 h-4 mr-2" />
        Try Again
      </button>
    </div>
  );
};
