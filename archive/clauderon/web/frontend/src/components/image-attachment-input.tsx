import { Label } from "@/components/ui/label";

type ImageAttachmentInputProps = {
  selectedFiles: File[];
  setSelectedFiles: React.Dispatch<React.SetStateAction<File[]>>;
};

export function ImageAttachmentInput({
  selectedFiles,
  setSelectedFiles,
}: ImageAttachmentInputProps) {
  return (
    <div className="space-y-2">
      <Label htmlFor="images">Attach Images (optional)</Label>
      <input
        type="file"
        id="images"
        accept="image/png,image/jpeg,image/jpg,image/gif,image/webp"
        multiple
        onChange={(e) => {
          if (e.target.files != null) {
            setSelectedFiles([...e.target.files]);
          }
        }}
        className="block w-full text-sm border-2 rounded file:mr-4 file:py-2 file:px-4 file:border-0 file:font-semibold"
      />
      {selectedFiles.length > 0 && (
        <div className="space-y-1 mt-2">
          {selectedFiles.map((file, i) => (
            <div
              key={i}
              className="flex items-center justify-between p-2 border-2 rounded bg-white"
            >
              <span className="text-sm truncate font-mono">{file.name}</span>
              <button
                type="button"
                onClick={() => {
                  setSelectedFiles((files) =>
                    files.filter((_, idx) => idx !== i),
                  );
                }}
                className="text-red-600 font-bold px-2 hover:bg-red-100 rounded"
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
