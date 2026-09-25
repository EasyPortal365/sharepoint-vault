---
title: "`.funcignore` pattern `src/` also empties `node_modules/*/src` — the deployment succeeds, the functions don't load"
short-title: "Unanchored `.funcignore` patterns strip your dependencies"
summary: "Azure/functions-action applies `.funcignore` with gitignore semantics to every path in the package, so `src/` or `test/` without a leading slash also empties those folders inside node_modules. A dependency whose entry file lives in `src/` (debug, for one) fails to load, the worker registers no functions and the function routes return 404. Anchor root patterns with a leading slash"
tags: [azure-functions, github-actions, deployment, nodejs, funcignore]
applies-to: "Azure Functions (Node.js) deployed with Azure/functions-action, `respect-funcignore: true` and `package` pointing to a folder"
last-reviewed: 2026-09-25
---

# `.funcignore` pattern `src/` also empties `node_modules/*/src`

> **Bottom line.** With `respect-funcignore: true`, Azure/functions-action matches every path in the package against `.funcignore` using gitignore semantics. A folder pattern whose only slash is the trailing one — `src/`, `test/` — matches at any depth, so it also empties `node_modules/debug/src` and similar folders. The dependency can't load, the worker registers no functions, and the function routes answer 404 while the deployment reports success. Write root patterns as `/src/`, `/test/`, `/infra/`.
>
> **Ve zkratce.** S `respect-funcignore: true` porovnává Azure/functions-action každou cestu balíčku s `.funcignore` podle pravidel `.gitignore`. Vzor složky, jehož jediné lomítko je to koncové – `src/`, `test/` – platí v jakékoli hloubce, takže vyprázdní i `node_modules/debug/src` a podobné složky. Závislost se nenačte, worker nezaregistruje žádnou funkci a trasy funkcí vracejí 404, přestože nasazení hlásí úspěch. Vzory pro kořen pište jako `/src/`, `/test/`, `/infra/`.

## Symptom

- The deploy step succeeds and the app's root URL still answers 200.
- A function route (in our case the health check) returns 404, and ARM returns an empty function list for the slot.
- The deployed `wwwroot` still lists `src`, `test` or `infra` — so it looks as if `.funcignore` wasn't applied at all.
- The host log has the real reason:

```
[Error] Error: Worker was unable to load entry point "dist/functions/routes.js": Cannot find module 'C:\home\site\wwwroot\node_modules\debug\src\index.js'. Please verify that the package.json has a valid "main" entry
[Warning] No job functions found. …
```

## Cause

When `package` points to a folder and `respect-funcignore` is on, the action globs every entry in that folder, makes each path relative to the package root and deletes it when the [`ignore`](https://github.com/kaelzhang/node-ignore) library says it's ignored — the same rules as `.gitignore`:

- `src/` has no slash at the start or in the middle, so it matches a `src` directory **at any level** — including `node_modules/debug/src`, so `node_modules/debug/src/index.js` goes too.
- The glob returns directory entries without a trailing slash, and a pattern ending in `/` only matches directories, so `ignore` doesn't match the folder entry itself. The folders stay behind, emptied of the matched files — which is why the deployed root still lists `src`, `test` and `infra`.

Measured with `ignore` 5.1.9 and 7.0.5 (the version functions-action v1 ships), same result:

| Path | `src/`, `test/` | `/src/`, `/test/` |
|---|---|---|
| `src/app.ts` | removed | removed |
| `node_modules/debug/src/index.js` | **removed** | kept |
| `node_modules/foo/test/x.js` | removed | kept |
| `dist/functions/routes.js` | kept | kept |

## Fix

Anchor every pattern to the package root:

```
/.git*
/.vscode/
/local.settings.json
/src/
/test/
/infra/
/tsconfig.json
/README.md
```

Keep the rule from coming back with a tiny test in the repository: read `.funcignore` and fail on any rule that doesn't start with `/`. An unanchored file pattern such as `README.md` or `tsconfig.json` removes the same files from every package in `node_modules` too — usually harmless, but it's the same trap.

## Notes

- When a deployment "succeeds" but no functions appear, read the host log first. With the default `fileLoggingMode: debugOnly` the host writes log files only while you're debugging in the Azure portal. Turn on `always` only temporarily — the documentation warns it hurts cold start and throughput — either in `host.json` (`"logging": { "fileLoggingMode": "always" }`) or, without a redeploy, through the app setting `AzureFunctionsJobHost__logging__fileLoggingMode` = `always`. Or read the traces in Application Insights.
- `az functionapp function list` has no `--slot` option; for a deployment slot call ARM directly: `GET …/providers/Microsoft.Web/sites/<app>/slots/<slot>/functions?api-version=2023-12-01`.
- Sources: [functions-action `.funcignore` handling](https://github.com/Azure/functions-action/blob/master/src/utils/funcignore.ts) · [gitignore pattern format](https://git-scm.com/docs/gitignore#_pattern_format) · [host.json `fileLoggingMode`](https://learn.microsoft.com/en-us/azure/azure-functions/functions-host-json#logging).
