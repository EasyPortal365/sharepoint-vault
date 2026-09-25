---
title: "GitHub Actions OIDC login to Azure fails with AADSTS700213 in repositories created after 15 July 2026"
short-title: "New GitHub repos send an OIDC subject with immutable IDs"
summary: "New GitHub repositories send the OIDC subject as `repo:owner@ownerId/repo@repoId:…`, so an Azure federated credential written in the classic `repo:owner/repo:…` form never matches and azure/login fails with AADSTS700213. Read the repository's `sub_claim_prefix` from the OIDC REST endpoint and build the subject from it"
tags: [azure, github-actions, oidc, entra-id, federated-credentials, deployment]
applies-to: Azure login from GitHub Actions through federated credentials (user-assigned managed identity or app registration)
last-reviewed: 2026-09-25
---

# GitHub Actions OIDC login to Azure fails with AADSTS700213 in new repositories

> **Bottom line.** Repositories created after 15 July 2026 send the OIDC `sub` claim with immutable IDs — `repo:octo-org@123456/my-repo@456789:ref:refs/heads/main` — instead of `repo:octo-org/my-repo:ref:refs/heads/main`. An Azure federated credential written in the classic form, the one repositories created before that date still use, never matches, and `azure/login` fails with AADSTS700213. Read the repository's `sub_claim_prefix` from `GET /repos/{owner}/{repo}/actions/oidc/customization/sub` and build the subject from it.
>
> **Ve zkratce.** Repozitáře založené po 15. 7. 2026 posílají v OIDC tokenu subjekt s neměnnými ID – `repo:org@123456/repo@456789:ref:refs/heads/main` – místo `repo:org/repo:ref:refs/heads/main`. Federovaná identita v Azure s klasickým tvarem, který dál používají repozitáře založené před tímto datem, se nikdy neshoduje a `azure/login` skončí chybou AADSTS700213. Prefix subjektu přečtěte z `GET /repos/{owner}/{repo}/actions/oidc/customization/sub` (`sub_claim_prefix`) a subjekt skládejte z něj.

## Symptom

The workflow builds and tests fine, then the login step fails:

```
Federated token details:
 subject claim - repo:octo-org@123456/my-repo@456789:ref:refs/heads/main
##[error]AADSTS700213: No matching federated identity record found for presented assertion subject 'repo:octo-org@123456/my-repo@456789:ref:refs/heads/main'. Check your federated identity credential Subject, Audience and Issuer …
```

The federated credential on the managed identity (or app registration) says `repo:octo-org/my-repo:ref:refs/heads/main` — the form that repositories created before 15 July 2026 still send.

## Cause

GitHub added immutable owner and repository IDs to the default `sub` claim, so that a recycled repository or organization name can't mint tokens that a cloud provider still trusts for the original repository. Repositories created after 15 July 2026 use the new format automatically; older repositories keep the classic format unless the organization or the repository opts in. GitHub Enterprise Server is not part of the change. The IDs stay in the subject even when you customize the claim with `include_claim_keys`.

Two repositories in one organization can therefore need different subject formats, and a template copied from an older repository is exactly what breaks.

## Fix

1. Ask GitHub what the repository sends (a classic personal access token or OAuth token needs the `repo` scope):

   ```
   GET https://api.github.com/repos/{owner}/{repo}/actions/oidc/customization/sub

   { "use_default": true, "use_immutable_subject": true,
     "sub_claim_prefix": "repo:octo-org@123456/my-repo@456789" }
   ```

2. Build the federated credential subject from `sub_claim_prefix` — `<prefix>:ref:refs/heads/main` for a branch, `<prefix>:environment:<name>` for a deployment environment. In Bicep keep the prefix as a parameter instead of composing it from the repository name:

   ```bicep
   param githubSubjectPrefix string = 'repo:octo-org@123456/my-repo@456789'

   resource federation 'Microsoft.ManagedIdentity/userAssignedIdentities/federatedIdentityCredentials@2023-01-31' = {
     parent: githubIdentity
     name: 'github-main'
     properties: {
       issuer: 'https://token.actions.githubusercontent.com'
       subject: '${githubSubjectPrefix}:ref:refs/heads/main'
       audiences: [ 'api://AzureADTokenExchange' ]
     }
   }
   ```

3. Deploy the credential again. The workflow itself needs no change.

## Notes

- The `azure/login` log prints the exact `subject claim` it presented. Compare it character by character with the credential before you touch issuer or audience — those are usually right.
- The immutable format is the safer one: a repository recreated under the old name gets new IDs, so it no longer matches the credential. It still contains the names too — rename the repository or the organization and the subject changes, so update the credential with it.
- Sources: [Immutable subject claims for GitHub Actions OIDC tokens](https://github.blog/changelog/2026-04-23-immutable-subject-claims-for-github-actions-oidc-tokens/) · [REST API endpoints for GitHub Actions OIDC](https://docs.github.com/en/rest/actions/oidc).
