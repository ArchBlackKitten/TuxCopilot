import type { NodeInput } from "@/lib/api";
import { useArch } from "./store";
import { sameNode } from "@/lib/changes";
import { errText } from "@/lib/host";
import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { FolderTree, SquareTerminal, Download } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import type { NodeDTO } from "@/lib/types";

export type NodeDraft = {
  id?: string;
  parentId: string | null;
  kind: "section" | "item";
  name: string;
  category: "command" | "download";
  source: "pacman" | "yay" | "github" | "ollama" | "flatpak" | "snap" | null;
  content: string;
  enabled: boolean;
};

export function emptyDraft(parentId: string | null): NodeDraft {
  return {
    parentId,
    kind: "section",
    name: "",
    category: "command",
    source: null,
    content: "",
    enabled: true,
  };
}

export function draftFromNode(node: NodeDTO): NodeDraft {
  return {
    id: node.id,
    parentId: node.parentId,
    kind: node.content?.trim() ? "item" : "section",
    name: node.name,
    category: node.category,
    source: node.source,
    content: node.content ?? "",
    enabled: node.enabled,
  };
}

interface Props {
  open: boolean;
  draft: NodeDraft | null;
  onClose: () => void;
  onSaved: () => void;
}

export function NodeDialog({ open, draft, onClose, onSaved }: Props) {
  const { toast } = useToast();
  const [form, setForm] = useState<NodeDraft>(emptyDraft(null));
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (draft) setForm(draft);
  }, [draft]);

  const set = (patch: Partial<NodeDraft>) => setForm((f) => ({ ...f, ...patch }));

  const save = async () => {
    if (!form.name.trim() && !form.content.trim()) {
      toast({ title: "Fluff needs a name or some content", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      const isEdit = Boolean(form.id);
      const payload: NodeInput = {
        name: form.name.trim() || form.content.trim().slice(0, 80),
        category: form.kind === "section" && !form.content.trim() ? "command" : form.category,
        source: form.category === "download" ? form.source : null,
        content: form.kind === "item" ? form.content.trim() : form.content.trim() || null,
        enabled: form.enabled,
        parentId: form.parentId,
      };
      // waits for Apply (top bar) like every other edit
      const st = useArch.getState();
      const already = !isEdit && sameNode(st.tree, payload);
      if (isEdit) st.nodeUpdate(form.id!, payload, `Edit "${payload.name}"`);
      else st.nodeCreate(payload);
      if (already) toast({ title: "Fluff already has it", description: `${payload.name} is already there, the same, so nothing new waits for Apply.` });
      else toast({ title: isEdit ? "Updated — pending" : "Added — pending", description: `${payload.name} · Apply to save, or Undo` });
      onSaved();
      onClose();
    } catch (err) {
      toast({
        title: "Fluff ran into a problem",
        description: errText(err, "Fluff couldn't save it"),
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg bg-card">
        <DialogHeader>
          <DialogTitle>{form.id ? "Edit" : "Add"} — {form.parentId ? "subsection / item" : "top-level section"}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* Kind selector */}
          {!form.id && (
            <div className="grid grid-cols-3 gap-2">
              {(
                [
                  { k: "section", icon: FolderTree, label: "Section", hint: "just a folder" },
                  { k: "item", icon: SquareTerminal, label: "Item", hint: "runs something" },
                ] as const
              ).map(({ k, icon: Icon, label }) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => set({ kind: k, ...(k === "section" ? {} : { category: form.category }) })}
                  className={`flex flex-col items-center gap-1 rounded-md border p-3 text-xs transition-colors ${
                    form.kind === k
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border text-muted-foreground hover:bg-accent"
                  }`}
                >
                  <Icon className="h-4 w-4" />
                  <span className="font-medium">{label}</span>
                  <span className="text-[10px] text-muted-foreground">{k === "section" ? "container" : "command / app"}</span>
                </button>
              ))}
              <div className="flex flex-col items-center justify-center gap-1 rounded-md border border-dashed p-3 text-xs text-muted-foreground">
                <Download className="h-4 w-4" />
                <span>Item + category</span>
                <span className="text-[10px]">= app / download</span>
              </div>
            </div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="nd-name">Name</Label>
            <Input
              id="nd-name"
              placeholder={form.kind === "section" ? "e.g. Rare Configs, Browsers…" : "e.g. Enable TRIM, firefox…"}
              value={form.name}
              onChange={(e) => set({ name: e.target.value })}
            />
          </div>

          {form.kind === "item" || form.content.trim() ? (
            <div className="space-y-1.5">
              <Label htmlFor="nd-content">Content</Label>
              <Textarea
                id="nd-content"
                rows={3}
                className="font-mono text-xs"
                placeholder={
                  form.category === "download"
                    ? form.source === "ollama"
                      ? "model tag, e.g. qwen3.8:27b or llama3.2:3b"
                      : form.source === "flatpak"
                        ? "Flathub app id(s), e.g. org.gimp.GIMP"
                        : form.source === "snap"
                          ? "snap name(s), e.g. spotify — add --classic if the store says so"
                          : "package name(s) or user/repo"
                    : "shell command, e.g. sudo systemctl enable fstrim.timer"
                }
                value={form.content}
                onChange={(e) => set({ content: e.target.value })}
              />
              <p className="text-[11px] text-muted-foreground">
                {form.category === "download"
                  ? form.source === "ollama"
                    ? "Plays as `ollama pull <model>` — one step per model tag."
                    : form.source === "flatpak"
                      ? "Plays as one `flatpak install --user flathub …` for all flatpaks — the id is on the app's Flathub page. Installs for you only, no password."
                      : form.source === "snap"
                        ? "Plays as `sudo snap install <name>`, one step per snap. Needs snapd (the Snaps section can set it up)."
                        : "pacman/yay: space-separate multiple packages — they get batched into one install command. github: user/repo or a full git URL."
                  : "Runs as-is via bash when you press Play."}
              </p>
            </div>
          ) : null}

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Category</Label>
              <Select
                value={form.category}
                onValueChange={(v) =>
                  set({
                    category: v as "command" | "download",
                    source: v === "command" ? null : (form.source ?? "pacman"),
                  })
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="command">command</SelectItem>
                  <SelectItem value="download">download</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {form.category === "download" && (
              <div className="space-y-1.5">
                <Label>Source</Label>
                <Select
                  value={form.source ?? "pacman"}
                  onValueChange={(v) => set({ source: v as NonNullable<NodeDraft["source"]> })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="pacman">pacman</SelectItem>
                    <SelectItem value="yay">yay</SelectItem>
                    <SelectItem value="github">github</SelectItem>
                    <SelectItem value="ollama">ollama</SelectItem>
                    <SelectItem value="flatpak">flatpak</SelectItem>
                    <SelectItem value="snap">snap</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>

          <div className="flex items-center justify-between rounded-md border p-3">
            <div>
              <div className="text-sm font-medium">Include in Play</div>
              <div className="text-xs text-muted-foreground">
                Switch controls whether this is considered on the next Play press.
              </div>
            </div>
            <Switch checked={form.enabled} onCheckedChange={(v) => set({ enabled: v })} />
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={save} disabled={saving}>
            {saving ? "Saving…" : form.id ? "Save changes" : "Add"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
