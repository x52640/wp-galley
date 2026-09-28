English | [繁體中文](./README.zh-TW.md)

# Galley

**A local AI copy desk for WordPress.** It runs only on your own computer.

**The AI is your copy editor; you are the editor-in-chief.** Paste in a draft and ask an AI you already
subscribe to and are signed in to (Codex, Claude Code or Antigravity) to proofread it and suggest images.
You decide on each suggestion, look at the finished page, and approve it. Only then does Galley send the
post to your site through the WordPress REST API.

Why it works this way:

- **The AI never touches your WordPress.** It only sees the text of your draft. It never gets your
  WordPress password, and each run happens in an isolated, read-only workspace with its tools turned off.
  Publishing is done by Galley's own fixed code, and only after you approve.
  Most AI plugins for WordPress work the other way round: install it on the site, grant it permissions,
  let it write for you.
- **No AI API key needed.** Galley calls the official CLI tools already signed in on your machine, so it
  uses the subscription you already pay for.
- **Nothing to install on your site.** It only uses WordPress's built-in Application Passwords and REST API.

![The draft workspace: the post in the middle, suggestions marked on the text, matching suggestion cards on the right](docs/images/workspace.png)

(Screenshot taken in demo-data mode; the content is made up. The interface is in Traditional Chinese.)

> **Early release, no support.** This is the author's own tool, open-sourced as is. You host it and fix it
> yourself. Please read [Limitations](#limitations) before using it.

## Features

- **Proofreading as proposals.** Typos, wording and factual issues are marked on the text, with a card for
  each on the right: accept, edit it yourself, or keep the original. The AI never edits your draft
  directly; issues that need a human call (say, two paragraphs that contradict each other) are only
  flagged.
- **Image suggestions and image generation with Codex.** The AI proposes where each image goes and what
  it should show, and you can edit the description on the card. If you have Codex, "generate with Codex"
  shows you the image first; it is uploaded to your WordPress media library only when you choose to use it.
- **Local proof.** See what the finished post will look like before it goes anywhere, and compare it with
  earlier versions (only changed paragraphs are shown).
- **Nothing publishes without approval.** The publish panel shows exactly what will be sent and where.
  You approve, then publish as a draft or as public.
- **Any edit cancels the approval.** An approval is tied to that exact version of the content; change
  anything and you have to approve again.
- **Insert images right in the post.** Click "insert image here" between any two paragraphs, then pick an
  uploaded image, upload one, or ask Codex to read the surrounding paragraphs and make one.
- **Suggested English slugs.** The AI reads the title and the start of the post and offers three English
  URL slugs, using a work's official English title when it knows one. Nothing is filled in until you click
  a suggestion. Especially handy for posts not written in English.
- **Choose the author.** Set a default author once per site; the publish panel shows it, and you can change
  it for a single post.
- **Setup wizard.** The first time you open Galley it walks you through connecting to WordPress,
  detecting AI editors and choosing where to publish. When a step fails, it tells you where and what to
  do next.

## Limitations

- **Local, single user, single site.** It listens only on `127.0.0.1`; it is not a hosted service. It
  connects to one WordPress site at a time.
- **The interface is currently in Traditional Chinese only.**
- **Only the post body is sent.** Everything around the post (title area, sidebars, footer) comes from
  your site's theme. Custom post types are not supported.
- **Content types.** Use the generic "post" and "page" types. The `longform` and `diary`
  types in the code are set up for the author's own site and are of no use elsewhere.
- **AI CLI terms of service.** The author has **not checked** whether each vendor's CLI terms allow a
  third-party tool to call it like this. Check this yourself before using Galley.
- **Making a post public cannot be undone.** Publishing may trigger newsletter or auto-sharing plugins on
  your site, and once those go out you cannot take them back. Publish as a draft first, check it in the
  WordPress admin, then make it public there.
- **No editing of published posts.** Once a post is out, edit it in the WordPress admin.

## Requirements

- macOS or Linux, Node.js 22.5 or later (it needs the built-in `node:sqlite`; developed on v26.7.0)
- A WordPress site served over **https** (5.6 or later, which has Application Passwords built in), and an
  account that can publish posts
- Optionally, at least one AI editor (see [AI editors](#ai-editors)). With none, you can still edit and
  publish by hand.

## Install and run

```bash
git clone https://github.com/x52640/wp-galley.git
cd wp-galley
npm install
npm run build
npm start                 # then open http://127.0.0.1:3000
```

The first time you open it, the **setup wizard** starts. You don't need to edit any config file first.

## Setup wizard

Four steps. When one fails, it tells you where it got stuck and what to do next.

1. **Connect to WordPress.** Enter the site URL, username and Application Password, then click
   "Test connection". The test is read-only (it creates or changes nothing on your site) and checks
   separately whether the URL is https, whether the site is reachable, whether a security plugin or your
   host is blocking the REST API, whether the credentials are right, whether Application Passwords have
   been disabled on the site, and whether the account can publish. When it passes, click "Save and continue".

   (Button names in this README are translated; the interface shows them in Chinese.)
2. **AI editors.** Detects whether each of the three CLIs is installed and signed in. For any that isn't,
   it shows the command to run in your terminal (Galley does not install or sign in for you).
3. **Where to publish.** Tick "Posts" and/or "Pages".
4. **Done.** You land on the drafts overview and can start a new draft.

Settings take effect as soon as they are saved, **no restart needed**. To change them later, click the
gear icon at the top right of the drafts overview and run the wizard again. If you switch to a different
site, the wizard first tells you what won't carry over (drafts already published to the old site, images
uploaded to the old site's media library) and saves only after you confirm.

When the connection test fails, it lists which checks passed, which one failed, and what to do next:

![Setup step 1: a failed connection test showing which check failed and the next step](docs/images/setup-1-connection.png)

Step 2 lists each AI editor's status, with the commands to run for any that is missing or signed out:

![Setup step 2: install and sign-in status of each AI editor](docs/images/setup-2-agents.png)

Step 3 chooses between posts and pages:

![Setup step 3: choosing to publish to posts or pages](docs/images/setup-3-destinations.png)

(Screenshots taken in demo-data mode; the URL and account are fake.)

### Getting an Application Password

An Application Password is a WordPress built-in password meant for external programs. It is **not your
login password**, and you can revoke it on its own at any time.

1. Ideally, create a dedicated account with the **Editor** role for Galley under Users → Add New.
   Don't use an administrator.
2. Log in to the admin as that account and go to Users → Profile.
3. Scroll to "Application Passwords" at the bottom, enter "Galley" as the name, and click
   "Add New Application Password".
4. Copy the whole 24-character password (shown in groups of four) and paste it into the wizard. It is
   shown only once.

If the "Application Passwords" section is missing, the site must be on https and a security plugin must
not have disabled it. The wizard's connection test tells you which one it is.

Note: resetting that account's login password revokes all of its Application Passwords. You'll need to
create a new one and run the wizard again.

### Where the password is stored

The wizard writes the URL, username and Application Password to `.env` in the project root (mode 0600,
readable only by your user account; listed in `.gitignore`, so it never goes into Git). Publish targets
go to `config/publish-targets.json` (a local file, also kept out of Git). The password travels from the
browser to the local backend once, when you click "Test connection", and never appears in any screen,
response or log after that. Details: [`docs/specs/security.md`](./docs/specs/security.md) (in Chinese).

## AI editors

Galley calls the official CLI tools already signed in on your computer, using your existing subscription.
All three are optional; one is enough. **Only Codex can generate images**; the other two can proofread and
suggest images but not draw them.

| AI editor | Subscription needed | Install | Sign in |
| --- | --- | --- | --- |
| Codex | Paid ChatGPT plan (Plus or above) | `npm install -g @openai/codex` | `codex login` |
| Claude Code | Paid Claude plan (Pro or above) | `npm install -g @anthropic-ai/claude-code` | `claude auth login` |
| Antigravity (`agy`) | Google account | Download from https://antigravity.google | Sign in the first time you run `agy`; if `agy models` lists models, you're set |

After installing or signing in, there's no need to restart Galley. Click "Detect again" in step 2 of the wizard.

Again: whether each CLI's terms allow a third-party tool to call it has not been checked. Please check for yourself.

## Manual setup (without the wizard)

```bash
cp .env.example .env                                           # fill in WORDPRESS_URL, WORDPRESS_USERNAME, WORDPRESS_APP_PASSWORD
cp config/publish-targets.example.json config/publish-targets.json
```

Changes to `.env` made by hand take effect after a restart. The three WordPress variables must be **all
set or all empty**; setting only some of them is an error at startup.

## Security design

- Binds only to `127.0.0.1`, and blocks DNS rebinding and state-changing requests sent from other websites.
- The AI returns structured data only; HTML is produced by fixed code, and the backend re-validates the
  AI's output against the original rules.
- AI CLIs run in an isolated job workspace, read-only, with shell, file-write, network and WordPress tools
  withheld, plus a timeout and one job at a time. They never see the WordPress password.
- The password lives only in backend memory and `.env`.
- Approvals can only be created from the local UI, and any change to the content cancels them.

Details: [`docs/specs/security.md`](./docs/specs/security.md) (in Chinese).

`.env`, `config/publish-targets.json`, `data/`, `drafts/`, `generated-images/` and `backups/` are all kept
out of version control.

## Development

```bash
npm run migrate           # creates data/publisher.sqlite (also applied automatically at startup)
npm run dev               # backend on 127.0.0.1:3000 + Vite UI on 127.0.0.1:5173
```

Add `?fixtures=1` to the UI URL for demo-data mode, which doesn't talk to the backend.
`?fixtures=1&setup=needed` starts at the setup wizard, and step 1 has a dropdown to simulate each kind of
connection failure.

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start the backend (tsx watch) and the Vite UI together |
| `npm run dev:server` | Backend only |
| `npm run dev:ui` | UI only (proxies `/api` to port 3000) |
| `npm run build` | Build the backend to `dist/` and the UI to `dist/ui/` |
| `npm start` | Run the built app |
| `npm run migrate` | Apply SQLite migrations |
| `npm test` | Run all tests (Vitest; never calls a real AI CLI or a real WordPress site) |
| `npm run test:watch` | Watch mode |
| `npx vitest run tests/health.test.ts` | Run a single test file |
| `npx vitest run -t "遮蔽"` | Run tests whose name contains a keyword |
| `npm run typecheck` | TypeScript check (no output) |
| `npm run verify` | Typecheck plus all tests (must pass before committing) |

## For contributors

Decisions and progress are tracked in a set of documents. Read these before changing code:

- [`plan.md`](./plan.md): goals, scope and decision log
- [`docs/README.md`](./docs/README.md): which document is authoritative, and the rules
- [`docs/CURRENT_TASK.md`](./docs/CURRENT_TASK.md): current work
- [`docs/specs/`](./docs/specs/README.md): technical specs

These documents are currently written in Traditional Chinese. Please open a pull request for new features.

## License

[MIT](./LICENSE). This is a self-hosted open-source tool: you host it and fix it yourself. No support is provided.

WordPress is a trademark of the WordPress Foundation. This project is not affiliated with the WordPress Foundation.
