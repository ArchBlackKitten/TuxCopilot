<p align="center">
  <img src="src-tauri/icons/128x128@2x.png" width="128" height="128" alt="Fluff, TuxCopilot's penguin">
</p>

<h1 align="center">TuxCopilot</h1>

<p align="center">
  A desktop companion for looking after an Arch Linux system:<br>
  your apps, your updates, your security, your services, from one window.
</p>

<h6 align="center">
  Public Key
</h6>

<h2 align="center">

  ```
  1C30 D714 9E20 A472 4D92 A4E3 24D4 340F E9E2 BF54
  ```
</h2>

<p align="center">
  <a href="#if-something-goes-wrong"><img src="https://img.shields.io/badge/Status-alpha%2C%20early%20stage-orange" alt="Status: Alpha, early stage"></a>
  <a href="#licence"><img src="https://img.shields.io/badge/Licence-AGPL--3.0--only-blue" alt="Licence: AGPL-3.0-only"></a>
  <a href="#installing-it"><img src="https://img.shields.io/badge/Platform-Built%20on%20Arch%20Linux-1793D1?logo=archlinux&logoColor=white" alt="Platform: Built on Arch Linux"></a>
  <a href="#for-developers"><img src="https://img.shields.io/badge/Built%20with-Tauri%202%20and%20Rust-24C8DB?logo=tauri&logoColor=white" alt="Built with Tauri 2 and Rust"></a>
</p>

---

TuxCopilot keeps the everyday work of running Arch in one place: updating
safely, installing and removing apps, protecting the computer, understanding
commands before you run them, finding out what failed, seeing what holds a
port, freeing disk space, running Docker apps and configuring Tor. It learns
your machine from the machine itself, explains what it is about to do in plain
words, recommends what to choose, and never changes anything until you have
seen it and said yes.

It is written for someone who has just installed Arch: nothing in it assumes
you already know what a firewall zone, a `.pacnew` file or a snapshot is. It
runs on Arch Linux and Arch-based systems (CachyOS, EndeavourOS and others),
on any desktop.

- [What it does](#what-it-does)
- [How it keeps your system safe](#how-it-keeps-your-system-safe)
- [Installing it](#installing-it)
- [Your first five minutes](#your-first-five-minutes)
- [A tour of each section](#a-tour-of-each-section)
- [Updating, changing the icon, removing](#updating)
- [Checking your copy is genuine](#checking-your-copy-is-genuine)
- [If something goes wrong](#if-something-goes-wrong)

> 🥚 **Alpha: an early stage, to try out.** Keep your expectations low: there is still a
> lot to review and fix. Don't rely on TuxCopilot for anything important yet. Try it with
> **Dry Run** on, read each command before you say yes, and keep your own backups.
>
> **Fluff has just hatched.** TuxCopilot's penguin, Fluff, is a chick still in its
> down, on its first time around: it may have bugs and make mistakes. When it does, tell us what happened
> (the **Feedback** section makes that easy) — feedback is how Fluff learns to do better. Its texts never
> hide what a command does, and every change waits for you to say yes.

## What it does

| Section | What you can do there |
|---|---|
| **Home** | Keep your useful commands and packages in sections and run a whole section with one **Play** button. See what fills your disk, and free package caches in one click. |
| **Commands** | Search every saved command. Type any command and get each part explained, typos fixed and risky ones flagged; or describe what you want in words and get the command. |
| **Apps** | Install from pacman, the AUR, Flathub, the Snap Store, GitHub and Ollama. Open any installed app's own page: what it is, what it needs, its settings, its services, and a fix for when it misbehaves. |
| **Updates** | Update the safe way: the Arch news first, a snapshot before, fresh mirrors, the AUR updates looked at. Below: firmware, and a way back if an update ever stops the computer from starting. |
| **App Manager** | See which apps you actually use, which you never open, and the leftover packages nothing needs, with clean removal plans for each. |
| **Security** | Every protection at a glance, then four sub-sections (Network, Devices, Accounts & login, System), each with four levels to choose from and Fluff's recommendation. |
| **Ports** | See every port in use, which program or service holds it, and who can reach it; switch a service on, off, or off for good. |
| **Services** | What runs in the background: running, failed or dormant, with On, Off and Kill. |
| **Troubleshoot** | Fluff's checkup: what failed and whether it matters, the errors since this start, settings files waiting after updates, and a report to give whoever helps you. |
| **Git** | Find the git clones taking up space, see which ones you still use, update them or remove them safely. |
| **Docker** | Start, stop, update and read the logs of your Docker apps, and set up apps such as Firefly III from their makers' own files. |
| **Tor** | Check Tor's connection, turn on bridges for networks that block it, and edit your whole Tor configuration option by option. |
| **Ollama** | See which local AI models your computer can run well. |
| **History** | Every run with everything it printed; each change to the system with its snapshots, **What it changed** and **Undo this change**; and every app that has left your machine. |
| **Feedback** | Tell Fluff's creator what went wrong, or what you'd like. You read every word first, and only you send it. |
| **Settings** | **Show me around** (Fluff's guide), **Relocate Fluff** (all of TuxCopilot and your apps in one sealed file, to take to another computer), the look (palettes, colour-blind-safe versions, your own icon), the lock, what TuxCopilot learned about your system, where commands run, how careful it should be, and **Is this the real TuxCopilot?** |

You can put the sections in your own order: drag the **≡** handle beside each
one in the side menu.

When something misbehaves, help is one click away. **Troubleshoot** looks at
the whole system; Docker, Tor and Ollama each have their own **Troubleshoot**,
which checks the usual causes and offers the fix for each problem; every app's
page has **Fix it**.

## How it keeps your system safe

- **Dry Run is on when you start.** Pressing Play only *shows* what would
  run. Nothing changes until you switch Dry Run off yourself.
- **It asks before anything real happens.** Each live run asks **"Are you
  sure?"** twice, each time showing exactly what will run. You choose how
  many times in **Settings → Run safety**.
- **Changes wait for Apply.** Edits, imports, removals and system changes
  collect in the top bar, where you can review, undo or discard them. Nothing
  is saved until you press **Apply**.
- **Your system is protected.** TuxCopilot learns what your system is made of
  (kernels, bootloader, login screen, desktops, the services that keep the
  machine running) from the system itself, and refuses to offer any of it for
  removal or switch it off.
- **Fluff won't run what would wreck the system.** A command that would wipe
  your disk, delete your home folder or break the system is stopped before
  anything runs, and a window says why. You may still copy it, if you really
  mean it.
- **A snapshot before Fluff changes the system.** If your system is on btrfs
  with snapper set up (Updates offers to set it up), every change Fluff makes
  to the system gets a snapshot just before and just after. **History** then
  shows **What it changed**, and **Undo this change** puts those files back.
  If the snapshot before couldn't be taken, nothing is changed.
- **You can't be locked out of your own keyboard.** After a change that
  blocks devices, Fluff asks you to type a word and click a circle within 30
  seconds. If you can't, it goes back by itself.
- **Nothing is thrown away by surprise.** Reset settings are set aside, not
  deleted. Every saved Tor configuration keeps the previous one as a backup.
  A git clone with unsaved work says so before it can be removed.
- **Configuration is checked before it is used.** Tor reads a new
  configuration and must accept it before it replaces yours; if it refuses,
  nothing changes and you see why.
- **Your data stays on your computer.** The usage log, your commands and your
  history live in one encrypted local file. The internet is used only to read
  public information: the Arch news, the AUR's page for an AUR package, Arch's
  security tracker, whether a package exists, a project's README, and the Tor
  Project's current bridges. Nothing about you is sent. Even Feedback sends
  nothing: you send it yourself, on GitHub's page.

---

## Installing it

You need a terminal (Konsole, GNOME Terminal, kitty, any of them). Copy each
grey block, paste it into the terminal with **Ctrl+Shift+V**, and press
**Enter**. When a command starts with `sudo`, it asks for *your* password.
Nothing appears on screen while you type it; that is normal.

### 1. Install what TuxCopilot is built with

```bash
sudo pacman -Syu --needed git base-devel rust nodejs npm webkit2gtk-4.1 openssl sqlcipher
```

If pacman asks a question, press **Enter** to accept the default.

> **Already use `rustup`?** Leave `rust` out of that line. The two conflict,
> and the one you have is fine.

### 2. Install a password helper

TuxCopilot runs commands in the background, with no terminal to type a
password into. When a command needs `sudo` (installing packages, updating), a
small password window opens instead. Install the one for your desktop:

```bash
sudo pacman -Syu --needed ksshaskpass            # KDE Plasma
```

```bash
sudo pacman -Syu --needed lxqt-openssh-askpass   # GNOME, Xfce, Hyprland, anything else
```

Without one, everything still works except steps that need `sudo`, and the
app tells you when that is the problem.

### 3. Download TuxCopilot

Download TuxCopilot into your home folder and go into it:

```bash
cd ~ && git clone https://github.com/ArchBlackKitten/TuxCopilot.git && cd TuxCopilot
```

### 4. Build and install it

```bash
./install.sh
```

The first build downloads its building blocks and compiles them. Expect
**5–15 minutes**, with a lot of text scrolling past. When it says **Done**,
TuxCopilot is in your application menu under *System*. This step does not
need `sudo`: everything goes into your own home folder.

### 5. Open it

Find **TuxCopilot** in your application menu, or run it from the terminal:

```bash
~/.local/bin/tuxcopilot
```

---

## Your first five minutes

1. **Fluff asks you to set up the lock** (see [The lock](#the-lock)): you scan
   a QR code with your device (or copy the key into its app by hand), choose a
   password code, and write the seed words on paper. It takes two minutes,
   once. Then Fluff asks **"Are we already friends?"**: **Relocate Fluff** if
   you packed Fluff's belongings on another computer, **🥚 Fresh start** if
   you're new.
2. **🥚 Fresh start:** Fluff asks **"Shall I show you around?"**. Press
   **Guide me**: a small card in the corner walks you through every section,
   one step at a time, and what to press next glows. **Next** takes you there,
   **Skip this step** moves on, **No guide** stops it. On the way it asks two
   things it can't know by itself: whether each network you're on is **Home**,
   **Work** or **Public** (a network you don't call home or work is treated as
   public, the safest), and whether you play games (the strictest kernel
   settings stop some games). Whether this is a laptop it reads by itself.
   **Settings → Show me around** starts the guide again whenever you like.

   Keep **Dry Run** on while you follow the guide (its first step points at
   it): then nothing you press changes the computer.
3. **Relocate Fluff:** Home fills with your sections from the other computer, and
   Settings → Relocate Fluff → **Get your apps back** lists what this computer
   still needs (see [Relocate Fluff](#relocate-fluff-tuxcopilot-on-another-computer)).

   **🥚 Fresh start:** Home starts empty, yours to fill. Click **New section**,
   name it (for example *Keep Arch healthy*), then on the section **Add
   subsection / item** → **Item**, with the command as its content, for
   example `sudo pacman -Syu --noconfirm`. Commands from elsewhere (a guide, a
   friend's setup) come in through **Parse manager** → **Import markup**, and
   **Copy** in the top bar shares yours the same way, as plain text.
4. Press **Play All**. With Dry Run on, the terminal panel lists the commands
   that *would* run, and nothing actually runs.
5. When the list looks right, click the **Dry Run** badge to switch to live
   mode and press Play again. You are asked **"Are you sure?"** and then
   **"Are you really sure?"**, each showing exactly what will run. Answer
   **No** to either and nothing happens. If a step needs `sudo`, the password
   window from step 2 of the installation appears next.
6. **Stop** halts a run at any time, including everything it started.
7. Open **Security → At a glance**. Each sub-section shows its level; Fluff
   recommends **Good security** everywhere, which costs nothing you'd notice.
8. Come back to **App Manager** after a day or two of normal use. It notes
   the apps you use while TuxCopilot is open.

---

## A tour of each section

### Home

Your commands and packages, kept in sections you name, each run with one
**Play** button. Sections can be nested, switched off, reordered and shared
as a file (**Export** / **Import** in the top bar).

**Disk used by apps** shows how full your disk is and what takes the space:
packages, flatpaks, Docker, Ollama models, git clones and package caches. It
lists the apps that would free the most if removed, together with what only
they need. Three buttons free space safely:

- **Free pacman cache** keeps only the package versions installed now.
- **Empty it completely** removes every cached package.
- **Free AUR builds** removes yay's build folders.

They first clear the half-downloaded files that interrupted pacman runs leave
behind (the cause of "could not open file … download-…" errors), and they
wait while pacman is busy.

#### Writing your own sections

The import markup works like HTML: tags wrap their contents, and you can nest
them as deep as you like. This example can be pasted as it is:

```
<section>Post Install
  <cmd>sudo systemctl enable fstrim.timer</cmd>
  <pacman>Media
    vlc
    mpv
  </pacman>
  <yay name="Fonts">
    ttf-jetbrains-mono-nerd
  </yay>
  <github>
    <pkg>zsh-users/zsh-autosuggestions</pkg>
  </github>
</section>
```

- **The first line inside a tag is its title.** `Post Install` names the
  section and `Media` names the pacman group. Every line after the title is
  one item.
- **Or give the title with `name="…"`.** Then every line inside is an item,
  as in the *Fonts* group above.
- **`<cmd>` holds a command; `<pkg>` holds one package.** Wrapping each item
  in `<pkg>` always works.
- **`<pacman>`, `<yay>`, `<github>` and `<ollama>`** say where everything
  inside them is installed from.
- **Watch out:** if you write `<pacman>` and then `vlc` on the very next line,
  *vlc* becomes the group's title and is **not installed**. The preview shows
  the result before you import, so check it.

### Commands

Every saved command in one searchable list, each with an **Explain** button.

**Arch Commands** explains any command you type, part by part: what each
program and flag does, typos it can correct, and warnings before risky ones
such as `rm -rf /` or a partial upgrade. It also works the other way round:
describe what you want in words ("remove packages nothing needs") and it
finds the best-matching command. It learns from your installed programs' own
help, so it works offline and without Ollama.

### Apps

Install lists for **pacman**, the **AUR** (through yay), **GitHub**,
**Ollama**, **Flatpaks** (Flathub) and **Snaps** (Snap Store). Buttons check
that a package really exists and open its web page, and the `-Syy` / `-Syu`
buttons update your system. If flatpak or snap is not set up yet, its section
offers a button that sets it up.

- Every install is `-Syu --needed`: the package lists are refreshed and the
  system is brought up to date in the same step, so a new package is never
  installed onto a half-updated system (on Arch, that can break programs).
  `--needed` skips what is already installed. Play answers pacman's questions
  for you (`--noconfirm`); Dry Run always shows the exact command first.
- **Flatpaks install for you only** (`flatpak install --user`): no password,
  and Flathub is added first if it is missing. **Snaps** need the snapd
  service; the Snaps section says when it is stopped and offers **Start
  snapd**. For a snap the Snap Store calls "classic", write `--classic` after
  its name, for example `code --classic`.
- **Is it safe to remove…?** tells you whether a package is part of your
  system before you go near it.

#### Every app has its own page

Click any app in **Apps → On this machine**, or any app name anywhere in
TuxCopilot, to open its page:

- **How it works:** what it is, the programs it adds, and whether it runs
  services in the background or starts at login.
- **What it needs:** what it depends on, which other apps need it, and its
  optional extras, each with an **add** button.
- **What you can change:** its services; its configuration files in `/etc`,
  marked when you have edited one or when a newer default is waiting
  (`.pacnew`); its settings folders in your home; and, for a flatpak, what it
  may reach (your files, the internet, devices).
- **Fix it:** clear its cache, reset its settings (set aside as a backup,
  with **Restore** to bring them back), reinstall it, restart its services and
  read their logs.
- **Running now:** each running copy with its process ID, its helper
  processes, and **End it** for your own.
- **Remove…** opens its removal plans.

At the top of the page, one control shows and sets the app's state:

- **On:** running.
- **Off:** stopped for now. Its services stop and every copy ends, but it
  starts again at the next restart or login, as it normally would.
- **Dead:** stopped and kept from starting. Its services are disabled, its
  login start is removed and every copy ends. What Dead changed is written
  down, so **On** puts back exactly that.

Apps that nothing starts by themselves only have On and Off. Apps that are
part of your system cannot be switched off. A page for an app that is not
installed offers to install it.

### Updates

Fluff recommends updating about once a week, everything at once (`-Syu`).
Before you update, it goes through the steps that keep an update from going
wrong, each marked fine or not, with a button to fix what isn't:

- **The Arch news.** News since your last update is listed, newest first.
  When an item asks you to do something by hand (marked **by hand**), the
  update buttons wait until you tick **I read the news marked "by hand" and
  know what to do.**
- **A snapshot before every update.** On btrfs, Fluff offers **Set up
  snapper** and **Install snap-pac**, so every update can be undone.
- **Fresh mirrors** (the servers packages come from), with **reflector**, or
  on CachyOS its own `cachyos-rate-mirrors`, never both.
- **AUR updates, looked at:** each AUR package being updated is checked, and
  the ones worth a closer look say why. AUR packages are made by users, not
  Arch: when yay asks *"Diffs to show?"*, type **A** to see what changed.

Then **Update Arch's packages** (`sudo pacman -Syu`) or **Update everything,
AUR too** (`yay -Syu`). **What would change** lists every package with its old
and new version.

**Firmware** lists updates for the computer's own parts (the BIOS, Secure
Boot's keys, the SSD), from fwupd, and says what installing each one means.

**A way back** is for the day an update stops the computer from starting. It
says which kernels you have, which start menu (Limine, GRUB or systemd-boot),
and whether that menu lists snapshots to start from, and how to choose them as
the computer starts. With only one kernel, Fluff recommends a second one (for
example `linux-lts`, or `linux-cachyos-lts` on CachyOS). **Check the start menu** asks for your password and
reads the menu's names only.

### Security

**At a glance** lists every protection, what it is now, and what Fluff would
change, a click away from where to change it. Then four sub-sections, each
with four cards:

- **As it comes:** Arch as installed. Always the way back.
- **Good security:** what Fluff recommends. Protection that costs nothing
  you'd notice.
- **Secured:** more, with its small costs said.
- **Hardened:** the strictest, with its costs said plainly.

Each card lists exactly what it sets. **Use Good security** (or the level you
picked) shows the commands, then asks "Are you sure?". Fluff remembers the
level you chose. If something changes it later (an update, another program, a
change by hand), the sub-section says so and offers **Put back**, and the
weekly checkup tells you too. Below the cards, each part can be set on its own:

- **Network:** the **Firewall**, which decides what may come in from each
  network. Its own settings are **Out and about** (right everywhere), **Home**
  and **Stealth** (the computer can't be seen at all), and you can tell Fluff
  which network is your home. DNS (how names like archlinux.org become
  addresses) can use your network's own server, Quad9 or Cloudflare, and whether the question travels encrypted. **Talking to other computers now** shows,
  by program, what is connected where.
  **VPN, Tor and the web: Fluff dismantles the myths** says how each works, what
  neither can do (neither is Wi-Fi protection: the firewall is), why a free
  VPN isn't as safe as it says, what Tor's last relay, the exit, can see,
  how websites fingerprint you, and what private windows and deleting your
  history really do.
- **Devices:** **Programs controlling your keyboard and mouse** and **USB
  sticks, USB disks and SD cards**, each **Allow**, **Ask** or **Block**; and
  **New USB devices (USBGuard)**, which blocks a USB stick pretending to be a
  keyboard.
- **Accounts & login:** **Your groups** (the ones that hand out root, and what
  happens if you leave one), **The screen lock** (after how long, on sleep,
  when the lid closes) and **Wrong passwords** (who tried, where and when).
- **System:** **Fluff's security check** (your packages against Arch's
  security tracker), **Did anyone change my system files?** (checked against
  the packages' own fingerprints and Fluff's), **The kernel's own
  protections** (Usual, Recommended, Strict, each setting said) and
  **Firmware**.

### App Manager

While TuxCopilot is open, it notes which apps you use: every 30 seconds
(adjustable) it looks at the running programs and recognises anything with an
entry in your application menu. From that it shows:

- your apps ranked by use, month by month;
- **Fully unused:** apps you installed yourself and never opened;
- **Orphans:** leftover packages that nothing needs any more.

Each app shows what would leave with it ("takes along: …"), exactly as pacman
would do it. Apps that belong to your system (System Settings, a desktop's
file manager) are still listed, so you can see they went unused, but flagged
**System**, placed last and never offered for removal.

**Removal plans** come step by step or all in one. The step-by-step plan asks
before deleting each thing, so the safe way to use it is **Copy**, then paste
it into a terminal. **Full elimination → All in one** does the whole job for
one app: it uninstalls the app and the dependencies only it needed, then
deletes its settings, cache, data and autostart entry. It never touches other
apps, and if the uninstall fails your data is left alone.

**Tracked & links** protects what you want to keep:

- A **tracked** app is never listed as unused and cannot be removed on its
  own. Pacman and AUR apps are also marked in pacman as installed on purpose,
  so no orphan clean-up removes them.
- A **link** says one app uses another, for example *obs-studio uses
  v4l2loopback-dkms*. Removing obs-studio then asks, for each app it uses,
  whether to keep it or remove it too.

Removed apps leave App Manager, and **History** notes when each one left.
TuxCopilot checks with pacman, flatpak and snap first, so an app that only
lost its menu entry is never counted as removed.

### Git

Your git clones, from your home folder's own subfolders, the usual clone
folders (`~/git`, `~/src`, `~/repos`, `~/github`, `~/code`, `~/clones`) and
any folder you add with **Add a folder…**. Nothing else is searched unless you
add it: not `~/Projects`, and never hidden folders, where tools keep their own
clones.

For each clone: its size, where it came from, and whether you still use it
(something runs from it, or you touched it in the last 30 days). Clones can be
**Updated** (`git pull --ff-only`) or **Removed**. When removing one would
lose work, such as uncommitted changes or commits never pushed, the button
says **Remove anyway** and names what would be lost. Your own projects, the
ones holding your commits, are listed but never offered for removal.

### Ports

Every port in use on your computer: which program holds it (with its process
ID), or which system service or Docker container; and whether only this
computer or your whole network can reach it. Click a port number to open
`http://localhost:<port>` in your browser. **Is a port free?** answers before
you pick one, and every port box in TuxCopilot warns while you type if the
port is taken, suggesting the nearest free one.

Each service has the same **On / Off / Dead** control as app pages. A service
is switched together with whatever starts it on demand: turning off only
`cups.service` would leave `cups.socket` to start it again, so both are
switched. Ports switched off stay listed so you can turn them back on. Ports
held by software the machine needs to run are tagged **System** and locked.

### Services

Everything that runs in the background, the system's and yours, sorted by
state: **Running**, **Failed**, **Dormant**, **On demand** and the rest. Each
has **On**, **Off** and **Kill**. The services the computer needs say so, and
Fluff keeps them on.

### Troubleshoot

Fluff's checkup of the whole system. It only reads; every fix asks first.

- **What failed**, and whether it matters: Fluff knows the common failures,
  why they usually happen, and which ones are harmless.
- **Errors since this boot, by program.**
- **Settings files waiting after updates.** When an update brings a new
  version of a settings file you changed, pacman leaves it beside yours as
  `.pacnew`. Fluff shows both and can merge them: **Keep mine**, **Use the new
  one** or **Use the merge**, with **Fluff recommends** on the one it would
  choose.
- **Fluff's weekly checkup**, off until you press **Yes, look weekly**. Once a
  week, even with TuxCopilot closed, Fluff looks for failed services, waiting
  settings files, a pacman lock left behind or a disk filling up, and sends a
  notification only when something needs you. It only reads.
- **A report for a helper.** When you ask for help on a forum or from a
  friend, they first ask how your computer stands. **Make the report** writes
  it: the system and its kernels, the updates, what the checkup sees, every
  Security level. It never holds a secret: no passwords, keys, settings files
  or journal lines, no names of people, computers or networks, and no
  addresses. You read it first, then **Save it…** or **Copy**. Nothing is sent.

### Docker

Your Docker apps (every folder in `~/docker` with a `compose.yml`, and
anything Docker Compose has started), each with **Open**, **Start**,
**Stop**, **Restart**, **Update** and **Logs**. The plain command behind each
button is shown, so you can learn them as you go.

**Set up an app that needs Docker** installs apps from their makers' own
files. Firefly III, for example, gets its own folder in `~/docker/firefly-iii`,
its current files, random secrets where its guide asks for them, and your time
zone, then opens at http://localhost:8080. If the makers change their files in
a way the setup does not expect, it stops before starting anything and links
their guide.

Your data is kept: **Remove (keep data)** removes an app's containers but
keeps its volumes and folder, and **Start** brings it back as it was. Only
**🔥 Remove everything** deletes the data, and it says so.

### Tor

Whether Tor is connected and how far it has got, its settings, the Tor apps
(Tor Browser, torsocks, nyx and the lyrebird bridge program) with **Install**
buttons, and the commands worth remembering.

- **How careful should Tor be?** Four presets, each a few of Tor's own
  options at once, shown before you save:
  - **Standard**: Tor as it comes.
  - **Secure**: each website gets its own path through Tor, so the sites you
    visit can't be linked by sharing one; Tor writes less to disk and never
    relays for others.
  - **Ghost**: the strictest Tor for the programs you send through it. Tor
    refuses requests that could leak where you're going, pads its traffic
    against analysis, changes paths more often, and uses bridges so your
    network can't tell you use Tor. Slower, and some programs refuse to work
    with it.
  - **Shadow**: the whole computer through Tor. Firewall rules of TuxCopilot's
    own send every connection into Tor and stop everything else (other UDP,
    IPv6, your local network). If Tor stops, the internet stops: nothing leaks.
    **Turn Shadow on** needs Tor connected first; **Is everything on Tor?**
    checks; **Turn Shadow off**, or a restart, always brings you back.

  Every preset is checked by Tor itself before it is used. No preset makes you
  anonymous by itself: what you sign in to, and what programs send about you,
  still tell. For the web, use Tor Browser.
- **Fluff recommends new bridges** after about a month, or whenever Tor gets
  stuck or something seems strange: bridges get found and blocked over time.
- **Bridges** let Tor work on networks that block it. Snowflake and obfs4
  bridges, and the line that tells Tor which program runs them, come from the
  file the Tor Project builds Tor Browser from, read at the moment you choose
  them, so they are current.
- **Settings** (SOCKS port, bridges, letting nyx watch Tor) are kept in a file
  of their own, `/etc/tor/torrc.d/tuxcopilot.conf`.
- **Your torrc** shows your whole `/etc/tor/torrc`, one row per option,
  including the ones it ships switched off. Each row has a switch, a box for
  its value, and the file's own explanation; the book button shows what your
  Tor's manual says about it. **Find** searches names and explanations, **Add
  an option** suggests every option your Tor knows, and **Whole file** shows
  it as plain text. **What will change** lists every changed line before you
  save.
- Saving waits for **Apply**. Tor checks the new file first: if it refuses,
  nothing changes and you see what Tor said. Each save keeps the previous file
  as `/etc/tor/torrc.bak-<date>`, and **Earlier copies** can put one back.
  After you edit torrc, a Tor update leaves its new default beside yours as
  `torrc.pacnew`, and the section tells you when one is waiting.

### Ollama

Looks at your processor, memory and graphics card and recommends the local AI
models your computer can run well.

### History

Every run with everything it printed, newest first, and every app that left
your machine, with the time TuxCopilot noticed. A run cut short because
TuxCopilot closed shows as **interrupted**, so you know to check its result.

A run that changed the system carries its snapshots (see [How it keeps your
system safe](#how-it-keeps-your-system-safe)), with two buttons:

- **What it changed** lists every file that changed between the two snapshots.
- **Undo this change** lists them first, then puts them back with snapper.
  Files only: a service it stopped stays stopped until you start it again.

### Feedback

Fluff is new at this. When it gets something wrong, tell its creator here:
pick what it is, tick where in TuxCopilot it happened, and write what you saw.
You can add, ticking each one: **About this TuxCopilot**, **About this
computer**, **The last thing that failed**, and **Anonymized logs, for review
later** (TuxCopilot's last runs, the system's errors since this start and the
helper's report, with your names, addresses, networks and your own files'
names taken out).

**What will be sent — exactly this** shows the whole message, and you can
change it. Then **1. Save it as a document** and **2. Open GitHub's page**,
and drag the file in; or **Copy it**, or **Or fill it in on GitHub**. Nothing
is sent until you press Submit on GitHub's page, and it is public there.

### Settings

**Show me around** starts Fluff's guide again. **Your system** shows what
TuxCopilot learned about your system (your Arch flavour, desktops, kernels and
bootloader) and lets you pick your OS if it was detected wrongly. **Where
commands run** lets runs open in your own terminal (kitty, WezTerm, Konsole,
Alacritty, foot, Ghostty, GNOME Terminal or xterm) instead of the built-in
panel. **Run safety** sets **How many "Are you sure?"** (two unless you change
it). **Is this the real TuxCopilot?** says what this copy can tell about
itself (a signed release, the creator's code, changed here, or a fork) and
how to check it from outside.

### The lock

TuxCopilot keeps private things: what you run, your apps, your settings. So its
database is **encrypted** ([SQLCipher](https://www.zetetic.net/sqlcipher/)), and
Fluff opens it only with two things together:

- the **30-second code** from an authenticator app on your device (Aegis, 2FAS,
  FreeOTP, Google Authenticator… any app that does "TOTP"), and
- your **password code**, which only you know: at least 8 characters, and a
  few words you will remember are best.

Honestly: the 30-second code guards TuxCopilot's door. The files themselves
open with the password code alone (or the seed words), a copy of them too, on
another computer, so the password code must be hard to guess. Tying the lock to this computer's security chip
(below) closes that.

**Setting it up** (the first time TuxCopilot opens, about two minutes):

1. Scan the QR code with your device's authenticator app, or copy the key shown
   under it (**Copy**) into the app by hand. Then type the 6 digits the app
   shows, to prove it works.
2. You choose your password code (8 characters or more), twice.
3. Fluff shows your **seed words**: 9 unless you chose another number. **Write them
   on paper**, in order, and keep the paper somewhere safe. Not in a file, a
   photo or a cloud: TuxCopilot never stores them, and whoever has them can open
   your data.
4. You type three of them back, so Fluff knows the paper is right. Optionally,
   **Save a recovery file…** too (keep it apart from the paper).
5. **Seal my data**: your database is encrypted where it lies, and TuxCopilot
   opens.

**Every time it opens:** the 30-second code and the password code. Wrong answers
slow down after three tries. Closing TuxCopilot always locks it.

**While it is open,** it locks itself after a pause with no one at it (10
minutes unless you change it), and opens again with your password code, or the
30-second code if you prefer. **Settings → Lock and signing → The lock** sets
both, and has **Lock now**, **Change my password code…** and **New device…**.
Each of those asks for your password code first, so someone at an unlocked
computer can't change your lock.

**Tied to this computer's security chip (TPM):** **Tie it…** makes a copy of
TuxCopilot's files impossible to open on any other computer, even with your
password code: this computer's chip must open it too. Your seed words still
open it anywhere, when you move house or if the chip is ever cleared (a BIOS
reset, some firmware updates, reinstalling Arch). Keep your paper safe.

**Lost your device or forgot the password code?** On the lock screen, **Lost your
device, or forgot your password code?** takes your seed words, and then you set
up the device and a new password code. If the lock file itself is gone
(`~/.local/share/tuxcopilot.desk/lock.json`), the recovery file and the seed
words together bring your data back. The recovery file is a standard
[age](https://age-encryption.org) file: `age -d tuxcopilot-recovery.age` opens it
without TuxCopilot. When it asks for the passphrase, type the seed words in
lowercase with one space between them.

**Honest limits.** Without the seed words, a lost device *and* a forgotten password
code mean the data stays locked for good. That is what makes it safe. While
TuxCopilot is paused, the database stays open behind the lock screen, so a
running update keeps its log. The encryption protects your data when
TuxCopilot is closed. Your computer's own disk encryption and login protect it
while you are signed in. If you used TuxCopilot before it had this lock, its
old, unlocked data may still sit in the disk's free space until it is written
over: on a disk encrypted when Arch was installed (LUKS) that is as safe as
everything else on it; on one that isn't, someone holding the disk could read
it.

### Relocate Fluff: TuxCopilot on another computer

There is one penguin, Fluff, and when you move to a new computer, Fluff moves
with you. **Settings → Relocate Fluff** packs Fluff's belongings into one file:
everything TuxCopilot knows (your sections and items, the history of runs, how
you use your apps, every setting and the look) and your apps (the ones you
installed from pacman, the AUR and Flatpak), their settings, your git clones,
Ollama models, Docker images, and Tor's and the firewall's settings. Take it to
the new computer (a USB stick is fine), or keep it somewhere safe in case this
one breaks.

1. **Pack Fluff's belongings…** asks for a passphrase. Type your own (twice), or
   press **Pick words for me** (9 words unless you choose another number).
   **Write it down**: TuxCopilot doesn't keep it, and without it nobody can open
   the file, not you and not anyone who finds it.
2. **Seal and save…** saves `fluff-<computer>-<date>.fluff`. It is encrypted
   with [age](https://age-encryption.org), with its SHA-256 checksum beside it,
   and signed if you chose your GPG key (Settings → Lock and signing).
3. On the new computer, install TuxCopilot and set up its lock. Fluff's welcome
   asks **"Are we already friends?"**: press **Relocate Fluff** (or later,
   Settings → Relocate Fluff → **Bring Fluff's belongings…**). TuxCopilot checks
   the file first, and a changed file is refused. Type the passphrase, and it
   shows where the belongings were packed, when, and what they hold. Nothing
   changes until you press **Replace this TuxCopilot with it**.
4. **Get your apps back** then lists what the new computer doesn't have yet,
   ticked, by source: the Arch repositories, the AUR, Flatpak, your git clones
   (downloaded again into the same folders of your home), your Ollama models
   and Docker images (downloaded again), and Tor's and your firewall's settings
   (each checked by Tor or firewalld before it is used; this computer's own are
   kept). Untick what you don't want; each button shows its command first, then
   runs it in the terminal. AUR apps need `yay`: if it isn't there, **Install
   yay first** does it. **Done — forget this list** when you're finished.

**Your apps' settings** come too: the folders in `~/.config` and the settings
files in your home (`.zshrc`, `.gitconfig`…). You tick which ones when you pack,
and again when you bring them in; large ones (a browser's profile) start
unticked, and settings can hold logins, which is one more reason the file is
sealed. They are put back during the import; a folder that is already there is
moved aside as `<name>.before-fluff-<date>`, never overwritten. Your keys
(`~/.ssh`, `~/.gnupg`) are never taken: move them yourself.

Before you pack, **Fluff recommends** what to do about what it *can't* bring
back: clones that exist only on this computer (no remote), and work you never
pushed. Push it first. A belongings file can come from anyone, so every app
name and git address in it is checked before it becomes a command; anything
odd is refused and shown. Passwords or tokens written into a git address stay
behind.

What was there before is packed first, in TuxCopilot's own folder
(`~/.local/share/tuxcopilot.desk/before-fluff-moved-<date>.fluff`), sealed by
the same passphrase. Bring those in to go back.

What Fluff learned about the *old* computer stays behind: which OS it is, its
package list, and the Commands knowledge read from its `--help` pages. On the
new computer Fluff learns its new home the first time it opens there. If
changes are waiting in the top bar, Apply or Undo them before bringing the
belongings in.

### Look: palettes, colour vision and your icon

**Settings → Look** changes how TuxCopilot looks. What you choose shows at once,
and **Apply** keeps it.

- **Palettes:** *Arch* (its own), *Night* (warm and dim, for the evening),
  *Sunny* (light, for daylight), *Monochrome*, *True black* (pure black and
  greys, for OLED screens) and *Manga Monotone*. Each one is shown as a small
  window with its text, accent and status colours.
- **Colour vision:** every palette also comes in a **red-green safe**
  version (for protanopia and deuteranopia) and a **blue-yellow safe** one
  (for tritanopia). The whole app follows: what reads as green for "done" and
  red for "failed" uses colours you can tell apart. The grey palettes read the
  same for everyone.
- **KDE Plasma and Krita colour schemes** work as palettes. The ones installed
  on your computer are listed under **Colour schemes on this computer**, one
  click each, and **Import a KDE / Krita colour scheme…** reads any `.colors`
  file. **Export this palette for KDE / Krita…** writes the palette you use
  as a `.colors` file; saved in `~/.local/share/color-schemes`, it appears
  among KDE's and Krita's own.
- **Change the icon…** takes any SVG or PNG. The header, the window and your
  application menu change, and an update keeps your icon. **Back to
  Fluff** restores Fluff, TuxCopilot's penguin.
- **Your look** is all of it in one file to share: palette, colour vision and
  icon, nothing private. **Export this look…** saves it as a `.tuxlook` file;
  anyone with TuxCopilot can **Import a look…** and have the same look in one
  step. The icon is checked on the way in: an SVG with scripts or links to
  the internet is refused.

### Changes wait for Apply

Nothing you change is saved straight away: sections and commands, imports,
tracking and links, orphans, Tor's settings and your torrc, the look, and the
options in Settings. Every change waits in the top bar:

- **Undo** (Ctrl+Z) and **Redo** (Ctrl+Shift+Z) step through your changes.
- **Apply** (Ctrl+S) saves them. Hover it to see the list.
- **✕** discards them all.

Changes that touch the system itself run last, after everything else is
saved, and go through your "Are you sure?" prompts. With Dry Run on, they are
only previewed and stay pending. Pending changes are kept if you close the
app. A removed package cannot be brought back by Undo, because pacman has no
undo; that is why removals wait for Apply.

### The terminal panel

Commands run in a real terminal session, so pacman, yay and downloads show
their progress live. **sudo asks for your password once per run**, in a small
window, however many steps need it. While a run is going, a clock and the
programs it is running show that it is alive, and the panel tells you when
the password window is waiting (it may be behind TuxCopilot's window).

---

## Updating

```bash
cd ~/TuxCopilot && git pull && ./install.sh
```

Your data, sections and settings are kept.

## Changing the icon

The icon is drawn from one picture, `Arts/Icon/Penguin.svg`. One command
draws any picture at every size the app and your desktop need:

1. Make your picture square: an **SVG** is best (sharp at every size), or a
   **PNG** of at least 1024 × 1024 pixels with a transparent background.
2. Put it in the project folder, for example in `Arts/Icon/`.
3. Run, with your file's name:

   ```bash
   cd ~/TuxCopilot && ./make-icons.sh Arts/Icon/my-icon.svg && ./install.sh
   ```

   `./make-icons.sh` on its own redraws Fluff.
4. If the menu still shows the old picture, log out and back in: the desktop
   keeps icons it has already drawn.

## Removing it

```bash
cd ~/TuxCopilot && ./install.sh --uninstall
```

That keeps your data. To delete the data as well:

```bash
rm -rf ~/.local/share/tuxcopilot.desk
```

Your data is one file, `~/.local/share/tuxcopilot.desk/tuxcopilot.db`.
**Export** in the top bar saves a backup of your sections; **Import** restores
one.

## Checking your copy is genuine

**Settings → Is this the real TuxCopilot?** says what this copy can tell
about itself: a signed release, the creator's code between releases, changed
on this computer, or a fork. A changed copy could change that check too, so it
also shows how to check from outside TuxCopilot.

Every release is signed with TuxCopilot's own release key. The first, v0.1.0, is an alpha:
an early stage, to try out.

```bash
cd ~/Downloads
for f in tuxcopilot-0.1.0.tar.gz tuxcopilot-0.1.0.tar.gz.asc tuxcopilot-0.1.0.tar.gz.sha256; do
  curl -LO https://github.com/ArchBlackKitten/TuxCopilot/releases/download/v0.1.0/$f
done
```

The key that signs them:

```
ArchBlackKitten (TuxCopilot releases)
1C30 D714 9E20 A472 4D92  A4E3 24D4 340F E9E2 BF54
```

A signature proves a release came from that key and was not changed on the
way. To check one, first get the key from somewhere other than the download
itself (a forger could swap both); ArchBlackKitten's GitHub profile serves it:

```bash
curl -s https://github.com/ArchBlackKitten.gpg | gpg --import
gpg --fingerprint 1C30D7149E20A4724D92A4E324D4340FE9E2BF54
```

The fingerprint gpg prints must match the one above, character for character.
Then check the release you downloaded, both ways:

```bash
gpg --verify tuxcopilot-0.1.0.tar.gz.asc tuxcopilot-0.1.0.tar.gz
sha256sum -c tuxcopilot-0.1.0.tar.gz.sha256
```

gpg must say **Good signature from "ArchBlackKitten (TuxCopilot releases)"**, and sha256sum
must say **OK**. In a downloaded copy of the code, `git verify-tag v0.1.0` checks the release
tag the same way.

Every commit is signed too, with ArchBlackKitten's SSH key. Its public half is in the code, so
in a downloaded copy you can check the newest commit:

```bash
git -c gpg.ssh.allowedSignersFile=keys/allowed_signers verify-commit HEAD
```

It must say **Good "git" signature**.

## If something goes wrong

| What you see | What to do |
|---|---|
| `./install.sh` says **Missing: …** | Run the line from step 1 again, then `./install.sh`. |
| `error: failed to … rust` or `cargo: command not found` | Close the terminal, open a new one, and run `./install.sh` again. |
| Play says **no password helper is installed** | Do step 2 of the installation, then press Play again. |
| A step says **a terminal is required to read the password** | Same: do step 2 of the installation. |
| App Manager lists something you know is part of your system | **Settings** → check that the right OS is selected, then **Refresh**. |
| Something you installed or removed in a terminal is not shown | Press **Refresh** in the top bar. |
| The window opens blank or white | Run `~/.local/bin/tuxcopilot` from a terminal and look at what it prints. |
| TuxCopilot is not in the menu straight away | Log out and back in, or start it with `~/.local/bin/tuxcopilot`. |
| Docker, Tor or Ollama misbehaves | Open its **Troubleshoot**: it checks the usual causes and offers the fix. |
| An app misbehaves | Open its page and use **Fix it**: clear its cache, reset its settings, reinstall it or restart its services. |
| A window says **Fluff won't run this one** | The command would wreck the system (wipe a disk, delete your home…). The window says why. If you really mean it, copy it and run it yourself. |
| **Can you still type and click?** appears | Type the word it shows, then click the circle, within 30 seconds. If you can't, Fluff puts back what it just changed by itself. |
| A Security sub-section says something changed your level | An update, another program or a change by hand moved it. Read what each part is now below, then **Put back** the level, or keep it as it is. |
| You don't know what something on screen means | **Settings → Show me around**: Fluff's guide walks through every section. |
| You want help from a forum or a friend | **Troubleshoot → A report for a helper → Make the report**, read it, then **Save it…** or **Copy**. |
| Fluff got something wrong | Tell its creator in **Feedback**. |

---

## For developers

TuxCopilot is a [Tauri 2](https://tauri.app) app: a Rust backend and a React,
TypeScript and Tailwind interface.

```bash
npm install
npm run tauri dev                     # live-reloading development window
npm test                              # interface tests
(cd src-tauri && cargo test)          # backend tests
```

How the code is laid out:

- `src/lib/`: what TuxCopilot knows and decides, and the commands it builds,
  in plain TypeScript.
- `src/components/arch/`: the sections you see.
- `src-tauri/src/`: the Rust side, which reads the system and runs commands.
- `src/*.test.ts` and the Rust `#[cfg(test)]` blocks: the tests. They never
  touch the real system: every program a command calls is faked.

Every command TuxCopilot runs is shown before it runs, and every change waits
for **Apply**: keep it that way in anything you add.

`./release.sh` makes a signed release: the tag, the tarball, its `.asc` and
`.sha256`, checked before it finishes, and `packaging/PKGBUILD` updated to name
it. It publishes nothing; it prints the commands that would.

## Licence

AGPL-3.0-only. See [`LICENSE`](LICENSE).
