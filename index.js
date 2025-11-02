const { Client, GatewayIntentBits, EmbedBuilder } = require("discord.js");
const { prefix, emojis } = require("./config");
require("dotenv").config();
require("./keep_alive"); // optional keep-alive for Render/BetterStack

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.MessageContent
  ]
});

// --- Embed Helper ---
function sendEmbed(channel, type, description) {
  const embed = new EmbedBuilder()
    .setTitle(type === "success" ? `${emojis.success} Success!` : `${emojis.fail} Error!`)
    .setDescription(description)
    .setColor(type === "success" ? "Green" : "Red")
    .setTimestamp();
  channel.send({ embeds: [embed] });
}

// --- Bot Ready ---
client.once("ready", () => {
  console.log(`${client.user.tag} is online!`);
});

// --- Voice State Handling (temporary VCs) ---
client.on("voiceStateUpdate", async (oldState, newState) => {
  const guild = newState.guild;
  if (!guild) return;

  const masterCat = guild.channels.cache.find(c => c.name === "Voice Master" && c.type === 4);
  const publicCat = guild.channels.cache.find(c => c.name === "Public VC" && c.type === 4);
  const privateCat = guild.channels.cache.find(c => c.name === "Private VC" && c.type === 4);

  // Public temporary VC
  if (newState.channel?.name === "Join to Make Public") {
    if (!publicCat) return;
    const tempVC = await guild.channels.create({
      name: `@${newState.member.user.username}’s Public VC`,
      type: 2,
      parent: publicCat.id,
      permissionOverwrites: [{ id: guild.id, allow: ["Connect", "ViewChannel"] }]
    });
    newState.setChannel(tempVC);
  }

  // Private temporary VC
  if (newState.channel?.name === "Join to Make Private") {
    if (!privateCat) return;
    const tempVC = await guild.channels.create({
      name: `@${newState.member.user.username}’s Private VC`,
      type: 2,
      parent: privateCat.id,
      permissionOverwrites: [
        { id: guild.id, deny: ["Connect"] },
        { id: newState.member.id, allow: ["Connect", "ViewChannel", "ManageChannels", "MuteMembers"] }
      ]
    });
    newState.setChannel(tempVC);
  }

  // Delete empty temporary VCs
  [publicCat, privateCat].forEach(cat => {
    if (!cat) return;
    cat.children.forEach(ch => {
      if (ch.members.size === 0) ch.delete().catch(() => {});
    });
  });
});

// --- Command Handling ---
client.on("messageCreate", async message => {
  if (!message.guild || message.author.bot) return;
  if (!message.content.startsWith(prefix)) return;

  const args = message.content.slice(prefix.length).trim().split(/ +/);
  const cmd = args.shift().toLowerCase();
  const member = message.member;
  const vc = member.voice.channel;

  // -------------------- .vc Commands --------------------
  if (cmd === "vc") {
    const sub = args[0]?.toLowerCase();
    if (!sub) return sendEmbed(message.channel, "fail", "Specify a subcommand.");

    const ownerId = vc?.members.firstKey();

    switch (sub) {
      case "lock":
        if (!vc) return sendEmbed(message.channel, "fail", "You are not in a VC.");
        if (member.id !== ownerId) return sendEmbed(message.channel, "fail", "Only VC owner can lock.");
        await vc.permissionOverwrites.edit(message.guild.id, { Connect: false });
        sendEmbed(message.channel, "success", "VC has been locked!");
        break;

      case "unlock":
        if (!vc) return sendEmbed(message.channel, "fail", "You are not in a VC.");
        if (member.id !== ownerId) return sendEmbed(message.channel, "fail", "Only VC owner can unlock.");
        await vc.permissionOverwrites.edit(message.guild.id, { Connect: true });
        sendEmbed(message.channel, "success", "VC has been unlocked!");
        break;

      case "kick":
        if (!vc) return sendEmbed(message.channel, "fail", "You are not in a VC.");
        if (member.id !== ownerId) return sendEmbed(message.channel, "fail", "Only VC owner can kick.");
        const target = message.mentions.members.first();
        if (!target) return sendEmbed(message.channel, "fail", "Mention a user to kick.");
        if (!vc.members.has(target.id)) return sendEmbed(message.channel, "fail", "User is not in your VC.");
        await target.voice.disconnect();
        sendEmbed(message.channel, "success", `${target.user.tag} has been kicked from your VC.`);
        break;

      case "unmute":
        if (!vc) return sendEmbed(message.channel, "fail", "You are not in a VC.");
        await member.voice.setMute(false);
        sendEmbed(message.channel, "success", "You are now unmuted!");
        break;

      // TODO: Add ban, permit, limit, info, rename, transfer following same embed pattern
    }
  }

  // -------------------- .vmsetup --------------------
  if (cmd === "vmsetup") {
    if (!member.permissions.has("ManageChannels")) return sendEmbed(message.channel, "fail", "You need Manage Channels permission.");

    const categories = { master: "Voice Master", public: "Public VC", private: "Private VC" };
    const createdCats = {};

    for (const [key, name] of Object.entries(categories)) {
      let cat = message.guild.channels.cache.find(c => c.name === name && c.type === 4);
      if (!cat) cat = await message.guild.channels.create({ name, type: 4 });
      createdCats[key] = cat;
    }

    const masterVCs = ["Join to Make Public", "Join to Make Private", "Join random Vc", "unmute urself"];
    for (const vcName of masterVCs) {
      if (!message.guild.channels.cache.find(c => c.name === vcName && c.parentId === createdCats.master.id)) {
        await message.guild.channels.create({ name: vcName, type: 2, parent: createdCats.master.id });
      }
    }

    sendEmbed(message.channel, "success", "Voice Master setup complete!");
  }

  // -------------------- .vmreset --------------------
  if (cmd === "vmreset") {
    if (!member.permissions.has("ManageChannels")) return sendEmbed(message.channel, "fail", "You need Manage Channels permission.");

    const categoriesToDelete = ["Voice Master", "Public VC", "Private VC"];
    for (const catName of categoriesToDelete) {
      const cat = message.guild.channels.cache.find(c => c.name === catName && c.type === 4);
      if (cat) {
        cat.children.forEach(ch => ch.delete().catch(() => {}));
        cat.delete().catch(() => {});
      }
    }

    sendEmbed(message.channel, "success", "Voice Master has been reset!");
  }
});

// --- Error Handling ---
process.on("unhandledRejection", console.error);
process.on("uncaughtException", console.error);

// --- Login ---
client.login(process.env.TOKEN);
