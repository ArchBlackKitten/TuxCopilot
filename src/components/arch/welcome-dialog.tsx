// The very first start: Fluff says hello and asks whether you are moving in from another
// computer — with Fluff's belongings, everything comes along (Settings → Relocate Fluff). After a
// fresh start it offers the guide (guide.ts): Guide me, or No guide (Settings has it any time).
import { useEffect, useState } from "react";
import { Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { iconUrl } from "@/lib/look-runtime";
import { IMPORT_EVENT, isFirstStart, markWelcomed } from "@/lib/penguin";
import { useArch } from "./store";

export function WelcomeDialog() {
  const { setView, look, setGuide } = useArch();
  const [open, setOpen] = useState(false);
  const [offer, setOffer] = useState(false); // the second page: "Shall I show you around?"
  useEffect(() => {
    isFirstStart().then(setOpen, () => {});
  }, []);

  const done = (thenImport: boolean) => {
    void markWelcomed().catch(() => {});
    if (!thenImport && !offer) return setOffer(true); // a fresh start: the guide is offered next
    setOpen(false);
    if (thenImport) {
      setView("settings");
      setTimeout(() => window.dispatchEvent(new Event(IMPORT_EVENT)), 300);
    }
  };

  const guideMe = () => {
    setOpen(false);
    setView("home");
    setGuide(0);
  };

  if (offer)
    return (
      <Dialog open={open} onOpenChange={(o) => !o && setOpen(false)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <div className="flex items-center gap-3">
              <img src={iconUrl(look.icon)} alt="" className="h-14 w-14" />
              <div>
                <DialogTitle>Shall I show you around?</DialogTitle>
                <DialogDescription>A short walk through every section, one step at a time.</DialogDescription>
              </div>
            </div>
          </DialogHeader>
          <p className="text-sm">
            What to press next will glow. You can skip any step, or stop whenever you like — and start it again from Settings. I'll ask two things I
            can't know by myself: whether the network you're on is home, work or public, and whether you play games.
          </p>
          <div className="flex flex-wrap justify-end gap-2 pt-2">
            <Button variant="ghost" onClick={() => setOpen(false)}>
              No guide
            </Button>
            <Button onClick={guideMe}>Guide me</Button>
          </div>
        </DialogContent>
      </Dialog>
    );

  return (
    <Dialog open={open} onOpenChange={(o) => !o && done(false)}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <div className="flex items-center gap-3">
            <img src={iconUrl(look.icon)} alt="" className="h-14 w-14" />
            <div>
              <DialogTitle>Hello, I'm Fluff</DialogTitle>
              <DialogDescription>your TuxCopilot — I'll help you look after this Arch computer.</DialogDescription>
            </div>
          </div>
        </DialogHeader>
        <div className="space-y-2 text-sm">
          <p>
            <b>Are we already friends?</b> If I lived with you on another computer, bring my belongings here (there: Settings → Relocate
            Fluff → Pack Fluff's belongings): your apps, their settings, your git clones, Tor and firewall settings and everything I knew
            come along.
          </p>
          <p className="text-muted-foreground">Just met? Then it's a fresh start — you can still bring my belongings any time, in Settings.</p>
          <p className="rounded-md border border-primary/30 bg-primary/5 p-2 text-xs">
            🥚 I'm a chick, just hatched — still in my down. This is my first time around, so I may stumble and make mistakes. When I
            do, tell me what happened: your feedback is how I learn, until one day I fledge.
          </p>
        </div>
        <div className="flex flex-wrap justify-end gap-2 pt-2">
          <Button variant="ghost" onClick={() => done(false)}>
            🥚 Fresh start
          </Button>
          <Button className="gap-1.5" onClick={() => done(true)}>
            <Upload className="h-4 w-4" /> Relocate Fluff
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
