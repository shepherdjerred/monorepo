import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CheckCircle } from "lucide-react";
import { useState } from "react";
import type { Session, MergeMethod } from "@clauderon/shared";

type MergePrDialogProps = {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (method: MergeMethod, deleteBranch: boolean) => void;
  session: Session;
}

export function MergePrDialog({ isOpen, onClose, onConfirm, session }: MergePrDialogProps) {
  // Get the initial method from session, or use the first available method
  const initialMethod = session.pr_default_merge_method ?? session.pr_merge_methods?.[0];

  const [selectedMethod, setSelectedMethod] = useState<MergeMethod | undefined>(
    initialMethod
  );
  const [deleteBranch, setDeleteBranch] = useState<boolean>(
    session.pr_delete_branch_on_merge ?? false
  );

  const handleConfirm = () => {
    if (selectedMethod) {
      onConfirm(selectedMethod, deleteBranch);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Merge Pull Request</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* Status checkmarks */}
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <CheckCircle className="w-4 h-4 text-green-500" />
              <span className="text-sm">CI checks passing</span>
            </div>
            <div className="flex items-center gap-2">
              <CheckCircle className="w-4 h-4 text-green-500" />
              <span className="text-sm">Review approved</span>
            </div>
            <div className="flex items-center gap-2">
              <CheckCircle className="w-4 h-4 text-green-500" />
              <span className="text-sm">No merge conflicts</span>
            </div>
          </div>

          {/* Merge method dropdown */}
          <div className="space-y-2">
            <label className="text-sm font-medium">Merge method</label>
            <Select
              value={selectedMethod ?? ""}
              onValueChange={(v) => { setSelectedMethod(v as MergeMethod); }}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select merge method" />
              </SelectTrigger>
              <SelectContent>
                {session.pr_merge_methods && session.pr_merge_methods.length > 0 ? (
                  session.pr_merge_methods.map((method) => (
                    <SelectItem key={method} value={method}>
                      {method}
                    </SelectItem>
                  ))
                ) : (
                  <div className="px-2 py-1.5 text-sm text-muted-foreground">
                    Loading merge methods...
                  </div>
                )}
              </SelectContent>
            </Select>
          </div>

          {/* Delete branch checkbox */}
          <div className="flex items-center space-x-2">
            <input
              id="delete-branch"
              type="checkbox"
              checked={deleteBranch}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => { setDeleteBranch(e.target.checked); }}
              className="w-4 h-4 rounded border-gray-300"
            />
            <label htmlFor="delete-branch" className="text-sm cursor-pointer">
              Delete branch after merge
            </label>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={handleConfirm} disabled={!selectedMethod}>
            Merge Pull Request
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
