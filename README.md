<div align="center"><a name="readme-top"></a>

<img src="public/panoptic-mark.png" width="140" height="140" alt="Panoptic Capture" />

# Panoptic Capture

**English** · [Español](./README.es.md) · [Português (BR)](./README.pt-BR.md) · [Français](./README.fr.md)

**Auto-capture any browser workflow into a step-by-step guide, then publish it to the Panoptic documentation hub.**

Click record, do the thing, get a polished guide with annotated screenshots. Narrate it as you go, edit it after, then replay, export or publish.

> **This is the Panoptic fork of [westpoint-io/mimik](https://github.com/westpoint-io/mimik).**
> The upstream extension is a local-first guide recorder: no account, no cloud, no tracking. This
> fork adds one thing, publishing a finished guide straight to the Panoptic documentation hub, which
> means a Kinde sign-in and a network call that upstream does not have. Everything else still runs
> in your browser. Upstream is tracked as the git remote `upstream`, so `git fetch upstream` pulls
> their work in.

<!-- SHIELD GROUP -->

[![License][license-shield]][license-link]
[![Manifest V3][mv3-shield]][mv3-link]
[![Local by default][local-shield]][local-link]
[![Account to publish][no-account-shield]][no-account-link]
<br/>
[![Stars][star-shield]][star-link]
[![Contributors][contributors-shield]][contributors-link]
![Last Commit][last-commit-shield]
[![Issues][issues-shield]][issues-link]

</div>

<details>
<summary><kbd>Table of contents</kbd></summary>

#### TOC

- [📺 Demo](#-demo)
- [👋 Getting Started](#-getting-started)
- [✨ Features](#-features)
  - [🔒 Smart Blur](#-smart-blur)
  - [🧠 AI descriptions (optional)](#-ai-descriptions-optional)
  - [▶️ Guide Me replay](#️-guide-me-replay)
  - [🎙️ Voice narration (optional)](#️-voice-narration-optional)
  - [✏️ Guide editor](#️-guide-editor)
  - [📤 Multi-format export](#-multi-format-export)
- [🔐 Privacy & storage](#-privacy--storage)
- [🤝 Contributing](#-contributing)
- [📜 License](#-license)

<br/>

</details>

## 📺 Demo

<div align="center">
<img src="https://github.com/user-attachments/assets/9de20b45-2256-4127-8242-141cf1802f39" alt="Panoptic Capture demo" width="800" />
</div>

## 👋 Getting Started

Panoptic Capture turns any repetitive browser task into a documented, shareable guide in seconds. Recording and editing run entirely in your browser. Nothing leaves your device until you choose to publish a guide to the documentation hub.

Whether you're documenting internal tools, writing product tutorials, or onboarding a teammate, Panoptic Capture captures every click, keystroke, and navigation automatically so you can focus on the work.

Every meaningful action becomes a step: clicks on buttons and links, form inputs, keyboard shortcuts, clipboard actions, drag events, and page navigations. Rapid clicks on nearby elements are merged so guides stay clean, and clicks are intercepted before the page navigates away, so nothing is lost on SPAs or full page loads.

Each step gets a screenshot with the clicked element highlighted and zoomed in. No manual cropping, no annotation tools to learn.

The three listings below are upstream's Mimik, not this fork. Panoptic Capture is not in any
store, so build it and load it unpacked. See [CONTRIBUTING.md](./CONTRIBUTING.md).

| Browser | Version | Install |
| ------- | ------- | ------- |
| Chrome  | [![Chrome Version][chrome-version-shield]][chrome-link]   | [Chrome Web Store][chrome-link] |
| Firefox | [![Firefox Version][firefox-version-shield]][firefox-link] | [Firefox Add-ons][firefox-link]  |
| Edge    | [![Edge Version][edge-version-shield]][edge-link]          | [Microsoft Edge Add-ons][edge-link] |

Available in English, Spanish, Brazilian Portuguese, French, and German. The AI description language is set separately, so you can run Panoptic Capture in English and generate guides in Spanish, or any combination.

> \[!IMPORTANT]
>
> **⭐️ Star [westpoint-io/mimik](https://github.com/westpoint-io/mimik)**, the upstream project this fork is built on. It helps other people discover it!

<a href="https://github.com/westpoint-io/mimik">
  <img width="100%" alt="Star mimik on GitHub" src="https://github.com/user-attachments/assets/80d304da-a765-4bde-bf49-b1bdcb4fe804" />
</a>

<div align="right">

[![Back to top][back-to-top]](#readme-top)

</div>

## ✨ Features

### 🔒 Smart Blur

Panoptic Capture automatically detects and blurs sensitive data in your screenshots: emails, phone numbers, SSNs, credit cards, IP addresses, MAC addresses. Toggle each category independently.

Need to blur something custom? The manual blur picker lets you select any DOM element and mask it across every screenshot where it appears.

<img src="https://github.com/user-attachments/assets/968d2518-c561-4d68-92a6-3d5f569fe38a" alt="Smart Blur" width="800" />

<div align="right">

[![Back to top][back-to-top]](#readme-top)

</div>

### 🧠 AI descriptions (optional)

Bring your own API key (OpenAI or Anthropic) and Panoptic Capture generates human-readable step descriptions like *"Click the **Submit** button to save changes"* instead of the rule-based `Click Submit`.

Descriptions are generated from a lightweight DOM context (~50-100 tokens), not screenshots. Roughly 15-30x cheaper than vision models. Choose the language you want descriptions in (English, Spanish, Portuguese, French, German).

<img src="https://github.com/user-attachments/assets/3540cbd5-133f-46fd-a9b6-ffce9b4d422a" alt="AI descriptions" width="800" />

<div align="right">

[![Back to top][back-to-top]](#readme-top)

</div>

### ▶️ Guide Me replay

Replay any guide live on a real page. Panoptic Capture highlights the next element to click, tracks your progress step by step, and advances automatically as you interact. Perfect for onboarding teammates or walking through a process yourself.

<img src="https://github.com/user-attachments/assets/56ffca1d-5074-491f-8571-dd70782d4b05" alt="Guide Me replay" width="800" />

<div align="right">

[![Back to top][back-to-top]](#readme-top)

</div>

### 🎙️ Voice narration (optional)

Talk through the workflow out loud while you record and Panoptic Capture turns what you said into the step
descriptions. Audio is transcribed with your own key (OpenAI or Groq) and matched to the steps it
belongs to, so you narrate once instead of writing every step by hand.

<img src="https://github.com/user-attachments/assets/061fddc7-da65-4641-8b39-d30b80c36531" alt="Voice narration" width="800" />

<div align="right">

[![Back to top][back-to-top]](#readme-top)

</div>

### ✏️ Guide editor

Fix a guide after the fact without re-recording. Crop, annotate and redact any screenshot, rewrite a
step with AI inline, drop headings and notes between steps, reorder or bulk-delete, and roll back
through version history.

<img src="https://github.com/user-attachments/assets/62d3a01e-b129-44c8-8ba3-e9b97ff08d7e" alt="Guide editor" width="800" />

<div align="right">

[![Back to top][back-to-top]](#readme-top)

</div>

### 📤 Multi-format export

Share guides in whatever format fits your workflow:

- **Video**: narrated walkthrough, mp4/H.264, with the cursor moving to each target
- **PDF**: print-ready, A4 portrait with auto page breaks
- **DOCX**: open and keep editing in Word
- **HTML**: self-contained, share anywhere, base64-embedded images
- **Markdown**: paste into Notion, GitHub, internal docs, wikis

All exports are generated client-side. Nothing touches a server.

<img src="https://github.com/user-attachments/assets/e7584527-7d68-4f3f-9261-8380ee08dfb4" alt="Multi-format export" width="800" />

<div align="right">

[![Back to top][back-to-top]](#readme-top)

</div>

## 🔐 Privacy & storage

Guides, steps, and screenshots live on your device. There's no telemetry. Your API keys (if you bring one) never leave your browser — they're stored locally and used to call the provider you chose directly.

Three things do leave the browser. Two are upstream's and are documented in their [privacy policy](https://mimik.westpoint.io/privacy/): site icons are fetched from Google's favicon service, which sends that site's domain, and the optional AI and voice features send text or audio to the provider you configured. The third is this fork's: publishing a guide sends that guide's steps and screenshots to the Panoptic documentation hub, and only when you press Publish.

<div align="right">

[![Back to top][back-to-top]](#readme-top)

</div>

## 🤝 Contributing

Contributions of all kinds are welcome: bug reports, feature requests, PRs, and translations.

See [CONTRIBUTING.md](./CONTRIBUTING.md) for development setup, project layout, and contributor guidelines.

<div align="right">

[![Back to top][back-to-top]](#readme-top)

</div>

## 📜 License

MIT © [Westpoint](https://github.com/westpoint-io). See [LICENSE](./LICENSE) for details.

This fork keeps that licence and that copyright. Panoptic IT Solutions wrote the publish-to-documentation-hub work on top of it.

<div align="right">

[![Back to top][back-to-top]](#readme-top)

</div>

<!-- LINK GROUP -->

[back-to-top]: https://img.shields.io/badge/-BACK_TO_TOP-1E1B4B?style=flat-square

[license-shield]: https://img.shields.io/badge/license-MIT-4F46E5?style=flat-square&labelColor=1E1B4B
[license-link]: ./LICENSE

[mv3-shield]: https://img.shields.io/badge/manifest-v3-3730A3?style=flat-square&labelColor=1E1B4B
[mv3-link]: https://developer.chrome.com/docs/extensions/mv3/intro/

[local-shield]: https://img.shields.io/badge/storage-local%20by%20default-4F46E5?style=flat-square&labelColor=1E1B4B
[local-link]: #-privacy--storage

[no-account-shield]: https://img.shields.io/badge/account-only%20to%20publish-4F46E5?style=flat-square&labelColor=1E1B4B
[no-account-link]: #-privacy--storage

[star-shield]: https://img.shields.io/github/stars/westpoint-io/mimik?style=flat-square&label=stars&color=4F46E5&labelColor=1E1B4B
[star-link]: https://github.com/westpoint-io/mimik/stargazers

[contributors-shield]: https://img.shields.io/github/contributors/westpoint-io/mimik?style=flat-square&labelColor=1E1B4B
[contributors-link]: https://github.com/westpoint-io/mimik/graphs/contributors

[last-commit-shield]: https://img.shields.io/github/last-commit/westpoint-io/mimik?style=flat-square&label=commit&labelColor=1E1B4B

[issues-shield]: https://img.shields.io/github/issues/westpoint-io/mimik?style=flat-square&labelColor=1E1B4B
[issues-link]: https://github.com/westpoint-io/mimik/issues

[chrome-version-shield]: https://img.shields.io/chrome-web-store/v/jmfohdaflahliammccpiadmkcibohgha?label=Chrome%20Version&style=flat-square&logo=googlechrome&logoColor=C7D2FE&color=4F46E5&labelColor=1E1B4B
[chrome-link]: https://chromewebstore.google.com/detail/mimik/jmfohdaflahliammccpiadmkcibohgha
[firefox-version-shield]: https://img.shields.io/amo/v/mimik?label=Firefox%20Version&style=flat-square&logo=firefoxbrowser&logoColor=C7D2FE&color=4F46E5&labelColor=1E1B4B
[firefox-link]: https://addons.mozilla.org/en-US/firefox/addon/mimik/
[edge-version-shield]: https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fmicrosoftedge.microsoft.com%2Faddons%2Fgetproductdetailsbycrxid%2Fhgjemhfoffebbollleajkpefblppleai&query=%24.version&label=Edge%20Version&style=flat-square&logo=microsoftedge&logoColor=C7D2FE&color=4F46E5&labelColor=1E1B4B
[edge-link]: https://microsoftedge.microsoft.com/addons/detail/hgjemhfoffebbollleajkpefblppleai
</content>
</invoke>