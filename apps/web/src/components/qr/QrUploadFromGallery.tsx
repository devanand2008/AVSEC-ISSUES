"use client";

import { FileImage } from "lucide-react";
import { useRef, type ChangeEvent } from "react";

interface QrUploadFromGalleryProps {
  disabled?: boolean;
  onFileSelected: (file: File) => void;
}

export function QrUploadFromGallery({ disabled = false, onFileSelected }: QrUploadFromGalleryProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  function onChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (file) onFileSelected(file);
  }

  return (
    <>
      <button className="btn btn-secondary" type="button" disabled={disabled} onClick={() => inputRef.current?.click()}>
        <FileImage size={18} />
        Choose QR image
      </button>
      <input ref={inputRef} type="file" accept="image/*" style={{ display: "none" }} onChange={onChange} />
    </>
  );
}
