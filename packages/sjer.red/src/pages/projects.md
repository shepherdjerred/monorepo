---
layout: ../layouts/MarkdownLayout.astro
title: Projects
description: Some of the things I've worked on over the years
---

This page documents some of the things I've worked on over the years.

<nav class="project-tabs" aria-label="Project sections" role="tablist">
  <button id="featured-tab" type="button" role="tab" aria-selected="true" aria-controls="featured-panel">Featured</button>
  <button id="all-tab" type="button" role="tab" aria-selected="false" aria-controls="all-panel">All</button>
</nav>

<style>
  .project-tabs {
    display: flex;
    gap: 0.25rem;
    margin: 1.5rem 0 2rem;
    border-bottom: 1px solid #d1d5db;
  }

  .project-tabs button {
    padding: 0.5rem 0.75rem;
    border: 0;
    border-bottom: 2px solid transparent;
    background: transparent;
    color: inherit;
    cursor: pointer;
    font: inherit;
  }

  .project-tabs button[aria-selected="true"] {
    border-bottom-color: #2563eb;
    color: #2563eb;
  }

  @media (prefers-color-scheme: dark) {
    .project-tabs {
      border-bottom-color: #374151;
    }
  }
</style>

<script>
  const initializeProjectTabs = () => {
    const article = document.querySelector("article");
    const featuredHeading = article?.querySelector("#featured");
    const allMarker = article?.querySelector("#all")?.closest("p");
    const featuredTab = document.querySelector("#featured-tab");
    const allTab = document.querySelector("#all-tab");

    if (
      !(article instanceof HTMLElement) ||
      !(featuredHeading instanceof HTMLElement) ||
      !(allMarker instanceof HTMLElement) ||
      !(featuredTab instanceof HTMLButtonElement) ||
      !(allTab instanceof HTMLButtonElement)
    ) {
      return;
    }

    if (article.dataset.projectTabsInitialized === "true") {
      return;
    }
    article.dataset.projectTabsInitialized = "true";

    const articleChildren = Array.from(article.children);
    const featuredStart = articleChildren.indexOf(featuredHeading);
    const allStart = articleChildren.indexOf(allMarker);
    const featuredContent = articleChildren.slice(featuredStart, allStart);
    const allContent = articleChildren.slice(allStart);
    const featuredPanel = document.createElement("div");
    const allPanel = document.createElement("div");

    featuredPanel.id = "featured-panel";
    featuredPanel.setAttribute("role", "tabpanel");
    featuredPanel.setAttribute("tabindex", "0");
    allPanel.id = "all-panel";
    allPanel.setAttribute("role", "tabpanel");
    allPanel.setAttribute("tabindex", "0");
    article.insertBefore(featuredPanel, featuredContent[0]);
    article.insertBefore(allPanel, allContent[0]);
    featuredContent.forEach((element) => featuredPanel.append(element));
    allContent.forEach((element) => allPanel.append(element));
    const tabs = [featuredTab, allTab];

    const setActiveTab = (activeTab) => {
      const showingFeatured = activeTab === "featured";
      featuredPanel.hidden = !showingFeatured;
      allPanel.hidden = showingFeatured;
      featuredTab.setAttribute("aria-selected", String(showingFeatured));
      allTab.setAttribute("aria-selected", String(!showingFeatured));
      featuredTab.tabIndex = showingFeatured ? 0 : -1;
      allTab.tabIndex = showingFeatured ? -1 : 0;
    };

    tabs.forEach((tab, index) => {
      tab.addEventListener("click", () =>
        setActiveTab(index === 0 ? "featured" : "all"),
      );
      tab.addEventListener("keydown", (event) => {
        if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") {
          return;
        }
        event.preventDefault();
        const nextIndex = (index + 1) % 2;
        const nextTab = tabs[nextIndex];
        nextTab.focus();
        setActiveTab(nextIndex === 0 ? "featured" : "all");
      });
    });
    setActiveTab(window.location.hash === "#all" ? "all" : "featured");
  };

  document.addEventListener("astro:page-load", initializeProjectTabs);
  initializeProjectTabs();
</script>

## Featured

### [Astro Open Graph Images](https://github.com/shepherdjerred/monorepo/tree/main/packages/astro-opengraph-images)

An Astro integration for generating customizable Open Graph images for static pages and content collections.

### [Scout for LoL](https://github.com/shepherdjerred/monorepo/tree/main/packages/scout-for-lol)

A Discord bot and dashboard that tracks League of Legends matches, sends game notifications, and produces detailed post-match reports, competitions, and leaderboards.

### [webring](https://github.com/shepherdjerred/monorepo/tree/main/packages/webring)

A small TypeScript library that fetches, sanitizes, caches, and truncates updates from RSS and Atom feeds.

### [Cooklang](https://github.com/shepherdjerred/cooklang-for-obsidian)

An Obsidian plugin that renders Cooklang recipes with rich previews, ingredients, directions, timers, nutrition, and metadata.

### [Better Skill Capped](https://github.com/shepherdjerred/monorepo/tree/main/packages/better-skill-capped)

A better interface for Skill Capped.

<span id="all"></span>

## Timeless

### [sjer.red](https://github.com/shepherdjerred/monorepo)

My personal website. You can see my site (and taste) evolve over the years on the [Wayback Machine](https://web.archive.org/web/20240000000000*/shepherdjerred.com)

## 2024

### [homelab](https://github.com/shepherdjerred/monorepo/tree/main/packages/homelab)

k3s Kubernetes cluster for self-hosted services like Plex, file syncing, and home automation. Self-updating with Renovate + ArgoCD + Chart Museum + GitHub Actions. Written in TypeScript with cdk8s and built with Bun.

### Tiger compiler

Compiler for the Tiger language for [graduate compilers](https://omscs.gatech.edu/cs-8803-o08-compilers-theory-and-practice) at Georgia Tech.

### [Astro Open Graph Images](https://github.com/shepherdjerred/monorepo/tree/main/packages/astro-opengraph-images)

Generate Open Graph images using React/Tailwind.

### [webring](https://github.com/shepherdjerred/monorepo/tree/main/packages/webring)

Fetch updates from lists of RSS feeds.

### [Scout for LoL](https://github.com/shepherdjerred/monorepo/tree/main/packages/scout-for-lol)

A Discord bot that tracks your friends' League of Legends matches. I've learnt a lot about developing with AI effectively while building this project.

## 2023

### [macOS cross compiler](https://github.com/shepherdjerred/monorepo/tree/main/sandbox/archive/macos-cross-compiler)

A C/C++/Fortran/Rust cross-compiler targeting amd64/aarch64 macOS from a Linux host.

### Paxos

Implementation of Paxos for graduate [distributed systems](https://omscs.gatech.edu/cs-7210-distributed-computing) at Georgia Tech.

### [Discord Plays Pokémon](https://github.com/shepherdjerred/monorepo/tree/main/packages/discord-plays-pokemon)

Multi-player Pokémon (or any Gameboy game) via Discord w/ video streaming & game input via chat.

## 2022

### EC2 Instance Control

Start/stop an EC2 instance. I created this to host game servers on EC2 while allowing friends to start/stop the server as needed, so that on-demand costs could be kept down.

- <https://github.com/shepherdjerred/monorepo/tree/main/sandbox/archive/ec2-instance-restart>
- <https://github.com/shepherdjerred/monorepo/tree/main/sandbox/archive/ec2-instance-restart-frontend>

## 2020

### [Better Skill Capped](https://better-skill-capped.com/)

A better interface for [Skill Capped](https://www.skill-capped.com/).

## College Years

These projects are pretty much all extracurricular. All of my coursework, aside from a few projects professors ask me to take down, is on [GitHub](https://github.com/shepherdjerred-homework).

In my first two years of college I was running a Minecraft server. I shut it down in 2017 and my projects gradually turned away from Minecraft.

### 2018/2019 (senior year)

#### [Castle Casters](https://github.com/shepherdjerred/monorepo/tree/main/sandbox/archive/castle-casters)

A game/game engine I wrote from scratch.

#### [Seminar Paper & Presentation](https://github.com/shepherdjerred-homework/seminar-paper)

I wrote a paper over 3D Graphics Rendering with OpenGL. I also published it as a [blog post on OpenGL rendering](/blog/2019/opengl/).

#### [Hue Saber](https://github.com/shepherdjerred/monorepo/tree/main/sandbox/archive/hue-saber)

Synchronize Hue lights to the game Beat Saber. The latency was, surprisingly, quite okay.

#### [Usher](https://github.com/shepherdjerred/monorepo/tree/main/sandbox/archive/usher)

Sign up for a chapel seat before selection opens.

#### [Cashly](https://github.com/shepherdjerred/monorepo/tree/main/sandbox/archive/cashly)

A personal finance simulator. [ProjectionLab](https://projectionlab.com/) does it better than I ever could.

### 2017/2018 (junior year)

#### [Easely](https://github.com/shepherdjerred/monorepo/tree/main/sandbox/archive/easely)

Alternative interface for Harding's computer science grading platform.

#### [Siphon](https://github.com/shepherdjerred/monorepo/tree/main/sandbox/archive/siphon)

Alternative interface for Harding's Pipeline web portal.

#### [Funsheet](https://github.com/shepherdjerred/monorepo/tree/main/sandbox/archive/funsheet)

Track and find fun things to do.

### 2016/2017 (sophomore year)

#### [Raspastat](https://github.com/shepherdjerred/monorepo/tree/main/sandbox/archive/raspastat)

A thermostat for my dorm using a Raspberry Pi. It looked like a bomb stuck to the wall.

#### [Pipe](https://www.spigotmc.org/resources/pipe.36307/)

Bash scripts to manage Minecraft servers

#### [UI.Flex Foundation](https://www.spigotmc.org/resources/web-ui-flex-foundation.36308/)

UI.Flex style built with Foundation

#### [The Storm Portal](https://www.spigotmc.org/resources/web-the-storm-portal.36306/)

Responsive homepage for Minecraft servers

#### [stTeleports](https://www.spigotmc.org/resources/stteleports.31533/)

Allow players to fairly teleport around

#### [The Button](https://github.com/shepherdjerred/monorepo/tree/main/sandbox/archive/the-button)

Press a button and make a counter go up.

#### [Maze Game](https://github.com/shepherdjerred/monorepo/tree/main/sandbox/practice/maze-game)

Pacman-esque game.

#### [RSI Hackathon](https://github.com/shepherdjerred/monorepo/tree/main/sandbox/archive/rsi-hackathon-2016)

I have no idea how, but my team won this.

### 2015/2016 (freshman year of college)

#### [stChat](https://www.spigotmc.org/resources/stchat.10646/)

Cross-server chat, channels, and text formatting

#### [stHalloween](https://www.spigotmc.org/resources/sthalloween.13736/)

Spooky Halloween features

#### [stTowns](https://www.spigotmc.org/resources/sttowns.14940/)

Allow players to form towns

#### [stNPC](https://www.spigotmc.org/resources/stnpc.12681/)

Create talking NPCs

#### [stBungeeMessages](https://www.spigotmc.org/resources/stbungeemessages.13561/)

Cross-server event messages

#### [stAnalytics](https://www.spigotmc.org/resources/stanalytics.12702/)

Player analytics

#### [stShards](https://www.spigotmc.org/resources/stshards.13880/)

End-game mechanic for gear

#### [stHorses](https://www.spigotmc.org/resources/sthorses.13879/)

Manage your horse companions

## High School Years

### [Front](https://www.spigotmc.org/resources/web-front.4648/)

Easy-to-edit Minecraft server website template. I charged $10-$15 for this template and ended up with about a hundred sales. This was huge for me at the time!

### Red Warfare

I was a web developer at [RedWarfare](https://github.com/libraryaddict/RedWarfare), a moderately-sized Minecraft server.

### [Portal](https://www.spigotmc.org/resources/web-portal.9815/)

Minecraft server homepage template

### [UI.X Bootstrap](https://www.spigotmc.org/resources/web-ui-x-bootstrap.5166/)

Web template to match a XenForo theme

### [stTitles](https://www.spigotmc.org/resources/sttitles.8310/)

Grant titles to players

### [stServerMessages](https://www.spigotmc.org/resources/stservermessages.6455/)

Customize server messages, MOTD, etc.

### The Storm

My Minecraft server that taught me everything I know from server administration, web development, and programming/scripting.

My surviving code is in a few places:

- <https://github.com/ShepherdJerred-minecraft>
- <https://github.com/shepherdjerred/monorepo/tree/main/sandbox/archive/ts-mc>
- <https://github.com/the-storm-mc>
- <https://www.spigotmc.org/resources/authors/riotshielder.51/>

Note that I recreated/moved a lot of these repositories so that commit history isn't correct, wiki/documentation is missing, and downloads for compiled artifact's don't exist.
