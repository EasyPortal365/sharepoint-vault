---
title: GitHub Pages HTTPS certificate never arrives when the domain was added before DNS existed
tags: [tooling, github-pages, dns, https]
applies-to: GitHub Pages (custom domains)
last-reviewed: 2026-07-16
---

# GitHub Pages HTTPS certificate never arrives when the domain was added *before* DNS existed

> **Bottom line.** GitHub Pages provisions the HTTPS certificate only at the moment you save the custom domain and never conspicuously retries if DNS wasn't resolving yet — remove the domain and add it back to restart provisioning once DNS is live.
>
> **Ve zkratce.** GitHub Pages vystaví HTTPS certifikát jen ve chvíli, kdy uložíš vlastní doménu, a pokud DNS tehdy ještě neodpovídalo, už to nápadně nezkouší znovu – odeber doménu a přidej ji zpět, aby se provisioning po naběhnutí DNS restartoval.

## Symptom

You set a custom domain on GitHub Pages, point DNS at it (or DNS goes live later — a freshly registered domain, say), the site serves fine over **HTTP** — but HTTPS never starts working. Hours pass. Enabling *Enforce HTTPS* via API fails with:

```json
{ "message": "The certificate does not exist yet", "status": "404" }
```

and `GET /repos/{o}/{r}/pages` shows an empty `https_certificate.state`.

## Cause

Certificate provisioning (Let's Encrypt) is kicked off **when the custom domain is saved**. If DNS didn't resolve to GitHub at that moment — domain not registered yet, records still propagating — the attempt fails, and GitHub doesn't conspicuously retry. The stuck state looks identical to "still working on it", which is why people wait hours before suspecting anything.

## Fix

**Remove the custom domain and add it back** — that restarts provisioning, and with DNS now correct the certificate is typically issued within moments:

```powershell
# API flavour (UI flavour: Settings → Pages → clear the domain, Save, re-enter, Save)
$body1 = '{"cname":null,"source":{"branch":"main","path":"/"}}'
$body2 = '{"cname":"example.com","source":{"branch":"main","path":"/"}}'
# PUT /repos/{owner}/{repo}/pages with $body1, wait a few seconds, then $body2
```

Then check `https_certificate.state` — once it says `issued`, enable `https_enforced`.

## Notes

- Right after issuance the edge rollout is **not atomic**: `www` may serve HTTPS minutes before the apex does. Don't re-panic during that window.
- The `http → https` 301 redirect appears only after *Enforce HTTPS* is on — until then HTTP serves content directly.
- Rule of thumb for new domains: **set the Pages custom domain *after* DNS resolves**, and this whole page becomes irrelevant to you.
