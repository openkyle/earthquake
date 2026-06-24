const MODULE_ID = "earthquake";
const SOCKET = `module.${MODULE_ID}`;

const SETTINGS = {
  intensity: "intensity",
  duration: "duration",
  soundPath: "soundPath",
  soundVolume: "soundVolume",
  shakeGM: "shakeGM",
  promptDexterity: "promptDexterity",
  dexterityDC: "dexterityDC",
  applyProne: "applyProne"
};

Hooks.once("init", () => {
  registerSettings();

  game.earthquake = {
    trigger: triggerEarthquake,
    promptDexterityChecks
  };
});

Hooks.once("ready", () => {
  game.socket.on(SOCKET, handleSocketMessage);
});

Hooks.on("renderChatMessage", (message, html) => {
  const buttons = html.find?.("[data-earthquake-roll]") ?? html.querySelectorAll?.("[data-earthquake-roll]");
  buttons?.on?.("click", event => onRollButtonClick(event));
  buttons?.forEach?.(button => button.addEventListener("click", event => onRollButtonClick(event)));
});

async function onRollButtonClick(event) {
    event.preventDefault();
    const button = event.currentTarget;
    await rollDexterityForToken(button.dataset.tokenId, button.dataset.messageId);
}

function registerSettings() {
  game.settings.register(MODULE_ID, SETTINGS.intensity, {
    name: "Shake Intensity",
    hint: "How far the canvas can move during the earthquake.",
    scope: "world",
    config: true,
    type: Number,
    default: 80,
    range: { min: 10, max: 250, step: 5 }
  });

  game.settings.register(MODULE_ID, SETTINGS.duration, {
    name: "Shake Duration",
    hint: "How long the earthquake lasts, in milliseconds.",
    scope: "world",
    config: true,
    type: Number,
    default: 5000,
    range: { min: 500, max: 30000, step: 500 }
  });

  game.settings.register(MODULE_ID, SETTINGS.soundPath, {
    name: "Earthquake Sound",
    hint: "Audio file played on every connected client when the earthquake starts.",
    scope: "world",
    config: true,
    type: String,
    default: `modules/${MODULE_ID}/assets/sounds/collapsing.ogg`,
    filePicker: "audio"
  });

  game.settings.register(MODULE_ID, SETTINGS.soundVolume, {
    name: "Earthquake Sound Volume",
    hint: "Playback volume for the earthquake sound.",
    scope: "client",
    config: true,
    type: Number,
    default: 0.8,
    range: { min: 0, max: 1, step: 0.05 }
  });

  game.settings.register(MODULE_ID, SETTINGS.shakeGM, {
    name: "Shake GM Canvas",
    hint: "When disabled, the GM can trigger earthquakes without shaking their own canvas.",
    scope: "client",
    config: true,
    type: Boolean,
    default: true
  });

  game.settings.register(MODULE_ID, SETTINGS.promptDexterity, {
    name: "Prompt Dexterity Checks",
    hint: "Create a chat prompt for tokens on the canvas after each earthquake.",
    scope: "world",
    config: true,
    type: Boolean,
    default: true
  });

  game.settings.register(MODULE_ID, SETTINGS.dexterityDC, {
    name: "Dexterity Check DC",
    hint: "Tokens that roll below this DC can be knocked prone.",
    scope: "world",
    config: true,
    type: Number,
    default: 15,
    range: { min: 1, max: 40, step: 1 }
  });

  game.settings.register(MODULE_ID, SETTINGS.applyProne, {
    name: "Knock Prone On Failed Check",
    hint: "Automatically apply the Prone status when a token fails the Dexterity check.",
    scope: "world",
    config: true,
    type: Boolean,
    default: true
  });
}

async function triggerEarthquake(options = {}) {
  const data = buildEarthquakeData(options);

  if (game.user.isGM) {
    game.socket.emit(SOCKET, { action: "executeEarthquake", data });
    await executeEarthquake(data);
    if (data.promptDexterity) await promptDexterityChecks(data);
    return;
  }

  game.socket.emit(SOCKET, { action: "requestEarthquake", data });
}

async function handleSocketMessage(message = {}) {
  const { action, data } = message;

  if (action === "requestEarthquake" && game.user.isGM) {
    game.socket.emit(SOCKET, { action: "executeEarthquake", data });
    await executeEarthquake(data);
    if (data.promptDexterity) await promptDexterityChecks(data);
    return;
  }

  if (action === "executeEarthquake") {
    await executeEarthquake(data);
    return;
  }

  if (action === "applyProne" && game.user.isGM) {
    await applyProneToToken(data?.tokenId);
  }
}

function buildEarthquakeData(options = {}) {
  return {
    intensity: Number(options.intensity ?? game.settings.get(MODULE_ID, SETTINGS.intensity)),
    duration: Number(options.duration ?? game.settings.get(MODULE_ID, SETTINGS.duration)),
    soundPath: options.soundPath ?? game.settings.get(MODULE_ID, SETTINGS.soundPath),
    soundVolume: options.soundVolume ?? null,
    shakeGM: options.shakeGM ?? null,
    promptDexterity: options.promptDexterity ?? game.settings.get(MODULE_ID, SETTINGS.promptDexterity),
    dexterityDC: Number(options.dexterityDC ?? game.settings.get(MODULE_ID, SETTINGS.dexterityDC)),
    applyProne: options.applyProne ?? game.settings.get(MODULE_ID, SETTINGS.applyProne)
  };
}

async function executeEarthquake(data = {}) {
  const volume = data.soundVolume ?? game.settings.get(MODULE_ID, SETTINGS.soundVolume);
  const shakeGM = data.shakeGM ?? game.settings.get(MODULE_ID, SETTINGS.shakeGM);

  await playEarthquakeSound(data.soundPath, volume);

  if (game.user.isGM && shakeGM === false) return;
  shakeCanvas(data.intensity, data.duration);
}

async function playEarthquakeSound(src, volume = 0.8) {
  if (!src) return;

  try {
    if (foundry.audio?.AudioHelper?.play) {
      await foundry.audio.AudioHelper.play({ src, volume, autoplay: true, loop: false }, false);
    } else if (globalThis.AudioHelper?.play) {
      await globalThis.AudioHelper.play({ src, volume, autoplay: true, loop: false }, false);
    } else {
      const audio = new Audio(src);
      audio.volume = volume;
      await audio.play();
    }
  } catch (error) {
    console.warn(`${MODULE_ID} | Could not play earthquake sound`, error);
  }
}

function shakeCanvas(intensity = 80, duration = 5000) {
  const board = document.getElementById("board") ?? document.getElementById("canvas");
  if (!board?.animate) return;

  const movement = Math.max(1, Number(intensity) / 20);
  board.animate([
    { transform: "translate(0, 0) rotate(0deg)" },
    { transform: `translate(${movement}px, ${movement}px) rotate(0.35deg)` },
    { transform: `translate(-${movement * 1.2}px, -${movement}px) rotate(-0.45deg)` },
    { transform: `translate(${movement * 1.4}px, -${movement * 0.8}px) rotate(0.4deg)` },
    { transform: `translate(-${movement}px, ${movement * 1.1}px) rotate(-0.35deg)` },
    { transform: "translate(0, 0) rotate(0deg)" }
  ], {
    duration: Math.max(250, Number(duration)),
    easing: "ease-in-out",
    iterations: 1
  });
}

async function promptDexterityChecks(data = buildEarthquakeData()) {
  if (!game.user.isGM) return;

  const tokens = canvas.tokens?.placeables?.filter(token => token.actor) ?? [];
  if (!tokens.length) {
    ui.notifications?.warn("Earthquake: no actor tokens are on the canvas.");
    return;
  }

  const tokenRows = tokens.map(token => {
    const ownerNames = game.users
      .filter(user => !user.isGM && token.actor.testUserPermission(user, "OWNER"))
      .map(user => foundry.utils.escapeHTML(user.name))
      .join(", ");
    const ownerText = ownerNames ? `<span class="earthquake-owners">${ownerNames}</span>` : "";

    return `<li>
      <button type="button" data-earthquake-roll data-token-id="${token.id}" data-message-id="">
        ${foundry.utils.escapeHTML(token.name)}
      </button>
      ${ownerText}
    </li>`;
  }).join("");

  const message = await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ alias: "Earthquake" }),
    content: `<section class="earthquake-card">
      <h2>Earthquake</h2>
      <p>Dexterity check DC ${data.dexterityDC}. Failed checks ${data.applyProne ? "knock the token prone." : "do not apply prone automatically."}</p>
      <ol>${tokenRows}</ol>
    </section>`,
    flags: {
      [MODULE_ID]: {
        dexterityDC: data.dexterityDC,
        applyProne: data.applyProne,
        results: {}
      }
    }
  });

  const content = message.content.replaceAll('data-message-id=""', `data-message-id="${message.id}"`);
  await message.update({ content });
}

async function rollDexterityForToken(tokenId, messageId) {
  const token = canvas.tokens?.get(tokenId);
  if (!token?.actor) {
    ui.notifications?.warn("Earthquake: that token is no longer on the canvas.");
    return;
  }

  if (!game.user.isGM && !token.actor.testUserPermission(game.user, "OWNER")) {
    ui.notifications?.warn(`You do not own ${token.name}.`);
    return;
  }

  const message = game.messages?.get(messageId);
  const flags = message?.getFlag(MODULE_ID, "results") ?? {};
  if (flags[tokenId]) {
    ui.notifications?.info(`${token.name} has already rolled for this earthquake.`);
    return;
  }

  const roll = await rollDexterityCheck(token.actor);
  if (!roll) return;

  const dc = Number(message?.getFlag(MODULE_ID, "dexterityDC") ?? game.settings.get(MODULE_ID, SETTINGS.dexterityDC));
  const applyProne = Boolean(message?.getFlag(MODULE_ID, "applyProne") ?? game.settings.get(MODULE_ID, SETTINGS.applyProne));
  const total = Number(roll.total ?? 0);
  const failed = total < dc;

  await message?.setFlag(MODULE_ID, "results", {
    ...flags,
    [tokenId]: { total, failed, userId: game.user.id }
  });

  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ token }),
    content: `<p><strong>${foundry.utils.escapeHTML(token.name)}</strong> rolled ${total} against Earthquake DC ${dc}: <strong>${failed ? "Failure" : "Success"}</strong>.</p>`
  });

  if (failed && applyProne) {
    if (game.user.isGM) await applyProneToToken(tokenId);
    else game.socket.emit(SOCKET, { action: "applyProne", data: { tokenId } });
  }
}

async function rollDexterityCheck(actor) {
  let nativeRollError = null;

  if (typeof actor.rollAbilityTest === "function") {
    const attempts = [
      ["dex", { chatMessage: true, fastForward: false }],
      [{ ability: "dex" }, {}, {}]
    ];

    for (const args of attempts) {
      try {
        const roll = await actor.rollAbilityTest(...args);
        if (Array.isArray(roll) && roll[0]?.total !== undefined) return roll[0];
        if (roll?.total !== undefined) return roll;
      } catch (error) {
        nativeRollError = error;
      }
    }
  }

  try {
    const data = actor.getRollData?.() ?? {};
    const roll = await new Roll("1d20 + @abilities.dex.mod", data).evaluate({ async: true });
    await roll.toMessage({
      speaker: ChatMessage.getSpeaker({ actor }),
      flavor: "Earthquake Dexterity Check"
    });
    return roll;
  } catch (error) {
    console.error(`${MODULE_ID} | Could not roll Dexterity check`, error, nativeRollError);
    ui.notifications?.error(`Earthquake: could not roll Dexterity for ${actor.name}.`);
    return null;
  }
}

async function applyProneToToken(tokenId) {
  const token = canvas.tokens?.get(tokenId);
  if (!token?.actor) return;

  try {
    if (typeof token.actor.toggleStatusEffect === "function") {
      await token.actor.toggleStatusEffect("prone", { active: true });
      return;
    }

    const effect = CONFIG.statusEffects?.find(status => status.id === "prone" || status.name === "Prone" || status.label === "Prone");
    if (effect && typeof token.document?.toggleActiveEffect === "function") {
      await token.document.toggleActiveEffect(effect, { active: true });
      return;
    }

    if (effect && typeof token.toggleEffect === "function") {
      await token.toggleEffect(effect.icon ?? effect.img, { active: true });
    }
  } catch (error) {
    console.error(`${MODULE_ID} | Could not apply prone to ${token.name}`, error);
    ui.notifications?.error(`Earthquake: could not apply Prone to ${token.name}.`);
  }
}
