import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { CheckCircle } from "lucide-react";
import { useState } from "react";
import type { Session, MergeMethod } from "@clauderon/shared";

interface MergePrDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (method: MergeMethod, deleteBranch: boolean) => void;
  session: Session;
}

export function MergePrDialog({ isOpen, onClose, onConfirm, session }: MergePrDialogProps) {
  const [selectedMethod, setSelectedMethod] = useState<MergeMethod>(
    session.pr_default_merge_method || "Merge"
  );
  const [deleteBranch, setDeleteBranch] = useState(
    session.pr_delete_branch_on_merge ?? false
  );

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
            <Select value={selectedMethod} onValueChange={(v) => setSelectedMethod(v as MergeMethod)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {session.pr_merge_methods?.map((method) => (
                  <SelectItem key={method} value={method}>
                    {method}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Delete branch checkbox */}
          <div className="flex items-center space-x-2">
            <Checkbox
              id="delete-branch"
              checked={deleteBranch}
              onCheckedChange={(checked) => setDeleteBranch(checked === true)}
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
          <Button onClick={() => onConfirm(selectedMethod, deleteBranch)}>
            Merge Pull Request
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
