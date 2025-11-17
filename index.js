const { Client, GatewayIntentBits, EmbedBuilder } = require("discord.js");
const { prefix } = require("./config");
require("./keep_alive"); // optional keep-alive server

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.GuildVoiceStates,
        GatewayIntentBits.MessageContent
    ]
});

// --- Whitelist ---
const ALLOWED_GUILDS = ["1426789471776542803"]; // your server ID

client.on("guildCreate", async guild => {
    if (!ALLOWED_GUILDS.includes(guild.id)) {
        console.log(`Left unauthorized guild: ${guild.name} (${guild.id})`);
        await guild.leave();
    }
});

client.once("ready", async () => {
    console.log(`${client.user.tag} is online!`);

    // Leave unauthorized servers on startup
    client.guilds.cache.forEach(async guild => {
        if (!ALLOWED_GUILDS.includes(guild.id)) {
            console.log(`Leaving unauthorized guild on startup: ${guild.name} (${guild.id})`);
            await guild.leave();
        }
    });
});

// --- Embed Helper ---
async function sendEmbed(channel, type, description) {
    const embed = new EmbedBuilder()
        .setTitle(type === "success" ? "Success!" : "Error!")
        .setDescription(description)
        .setColor("#ADD8E6") // light blue
        .setTimestamp();
    await channel.send({ embeds: [embed] });
}

// --- Voice State Handling ---
client.on("voiceStateUpdate", async (oldState, newState) => {
    const guild = newState.guild;
    if (!guild || !ALLOWED_GUILDS.includes(guild.id)) return;

    const masterCat = guild.channels.cache.find(c => c.name.includes("MAKE YOUR VOICE") && c.type === 4);
    const publicCat = guild.channels.cache.find(c => c.name.includes("public vcs") && c.type === 4);
    const privateCat = guild.channels.cache.find(c => c.name.includes("private vcs") && c.type === 4);

    const channelName = newState.channel?.name;

    // --- Temp Public VC ---
    if (channelName && channelName.toLowerCase().includes("make a public vc")) {
        if (!publicCat) return;
        const tempVC = await guild.channels.create({
            name: `${newState.member.user.username}’s channel`,
            type: 2,
            parent: publicCat.id,
            permissionOverwrites: [{ id: guild.id, allow: ["Connect", "ViewChannel"] }]
        });
        await newState.setChannel(tempVC);
    }

    // --- Temp Private VC ---
    if (channelName && channelName.toLowerCase().includes("make a private vc")) {
        if (!privateCat) return;
        const tempVC = await guild.channels.create({
            name: `${newState.member.user.username}’s channel`,
            type: 2,
            parent: privateCat.id,
            permissionOverwrites: [
                { id: guild.id, deny: ["Connect"] },
                { id: newState.member.id, allow: ["Connect", "ViewChannel", "ManageChannels", "MuteMembers"] }
            ]
        });
        await newState.setChannel(tempVC);
    }

    // --- Join Random VC ---
    if (channelName && channelName.toLowerCase().includes("join a random vc")) {
        if (!publicCat) return;
        const publicVCs = publicCat.children.cache.filter(c => c.type === 2 && c.members.size < (c.userLimit || Infinity));
        if (!publicVCs.size) return;
        const randomVC = publicVCs.random();
        await newState.setChannel(randomVC);
    }

    // --- Unmute Yourself ---
    if (channelName && channelName.toLowerCase().includes("unmute yourself")) {
        await newState.member.voice.setMute(false);
        if (oldState.channel) await newState.setChannel(oldState.channel).catch(() => {});
    }

    // --- Delete empty temp VCs ---
    [publicCat, privateCat].forEach(cat => {
        if (!cat || !cat.children) return;
        cat.children.cache.forEach(ch => {
            if (ch.members.size === 0) ch.delete().catch(() => {});
        });
    });
});

// --- Command Handling ---
client.on("messageCreate", async message => {
    if (!message.guild || message.author.bot) return;
    if (!ALLOWED_GUILDS.includes(message.guild.id)) return;
    if (!message.content.startsWith(prefix)) return;

    const args = message.content.slice(prefix.length).trim().split(/ +/);
    const cmd = args.shift().toLowerCase();
    const member = message.member;
    const vc = member.voice.channel;

    // -------------------- VC Commands --------------------
    if (cmd === "vc") {
        const sub = args[0]?.toLowerCase();
        if (!sub) return await sendEmbed(message.channel, "fail", "Specify a subcommand.");
        if (!vc && !["unmute", "hide", "unhide"].includes(sub)) return await sendEmbed(message.channel, "fail", "You must be in a VC.");

        const ownerId = vc?.members.firstKey();
        const target = message.mentions.members.first();

        switch (sub) {
            case "lock":
                if (member.id !== ownerId) return await sendEmbed(message.channel, "fail", "Only VC owner can lock.");
                await vc.permissionOverwrites.edit(message.guild.id, { Connect: false });
                await sendEmbed(message.channel, "success", "VC has been locked!");
                break;

            case "unlock":
                if (member.id !== ownerId) return await sendEmbed(message.channel, "fail", "Only VC owner can unlock.");
                await vc.permissionOverwrites.edit(message.guild.id, { Connect: true });
                await sendEmbed(message.channel, "success", "VC has been unlocked!");
                break;

            case "kick":
                if (member.id !== ownerId) return await sendEmbed(message.channel, "fail", "Only VC owner can kick users.");
                if (!target) return await sendEmbed(message.channel, "fail", "Mention a user to kick.");
                if (!vc.members.has(target.id)) return await sendEmbed(message.channel, "fail", "User is not in your VC.");
                await target.voice.disconnect();
                await sendEmbed(message.channel, "success", `${target.user.tag} has been kicked from your VC.`);
                break;

            case "ban":
                if (member.id !== ownerId) return await sendEmbed(message.channel, "fail", "Only VC owner can ban users.");
                if (!target) return await sendEmbed(message.channel, "fail", "Mention a user to ban.");
                await vc.permissionOverwrites.edit(target.id, { Connect: false });
                await sendEmbed(message.channel, "success", `${target.user.tag} has been banned from your VC.`);
                break;

            case "permit":
                if (member.id !== ownerId) return await sendEmbed(message.channel, "fail", "Only VC owner can permit users.");
                if (!target) return await sendEmbed(message.channel, "fail", "Mention a user to permit.");
                await vc.permissionOverwrites.edit(target.id, { Connect: true });
                await sendEmbed(message.channel, "success", `${target.user.tag} is now allowed in your VC.`);
                break;

            case "limit":
                const limit = parseInt(args[1]);
                if (isNaN(limit)) return await sendEmbed(message.channel, "fail", "Provide a number as limit.");
                await vc.setUserLimit(limit);
                await sendEmbed(message.channel, "success", `VC user limit set to ${limit}.`);
                break;

            case "rename":
                const newName = args.slice(1).join(" ");
                if (!newName) return await sendEmbed(message.channel, "fail", "Provide a new name.");
                await vc.setName(newName);
                await sendEmbed(message.channel, "success", `VC renamed to ${newName}.`);
                break;

            case "transfer":
                if (!target) return await sendEmbed(message.channel, "fail", "Mention a user to transfer VC ownership.");
                await vc.permissionOverwrites.edit(ownerId, { Connect: false, ManageChannels: false });
                await vc.permissionOverwrites.edit(target.id, { Connect: true, ManageChannels: true });
                await sendEmbed(message.channel, "success", `VC ownership transferred to ${target.user.tag}.`);
                break;

            case "info":
                const infoEmbed = new EmbedBuilder()
                    .setTitle("VC Info")
                    .setDescription(`Name: ${vc.name}\nOwner: <@${ownerId}>\nMembers: ${vc.members.size}\nUser Limit: ${vc.userLimit || "None"}`)
                    .setColor("#ADD8E6")
                    .setTimestamp();
                await message.channel.send({ embeds: [infoEmbed] });
                break;

            case "unmute":
                await member.voice.setMute(false);
                await sendEmbed(message.channel, "success", "You are now unmuted!");
                break;

            case "hide":
                if (member.id !== ownerId) return await sendEmbed(message.channel, "fail", "Only VC owner can hide the VC.");
                await vc.permissionOverwrites.edit(message.guild.id, { ViewChannel: false });
                await sendEmbed(message.channel, "success", "VC is now hidden from everyone!");
                break;

            case "unhide":
                if (member.id !== ownerId) return await sendEmbed(message.channel, "fail", "Only VC owner can unhide the VC.");
                await vc.permissionOverwrites.edit(message.guild.id, { ViewChannel: true });
                await sendEmbed(message.channel, "success", "VC is now visible to everyone!");
                break;
        }
    }

    // -------------------- VM Setup Command --------------------
    if (cmd === "vmsetup") {
        if (!member.permissions.has("ManageChannels")) return await sendEmbed(message.channel, "fail", "You need Manage Channels permission.");
        const categories = { master: "MAKE YOUR VOICE", public: "public vcs", private: "private vcs" };
        const createdCats = {};

        for (const [key, name] of Object.entries(categories)) {
            let cat = message.guild.channels.cache.find(c => c.name === name && c.type === 4);
            if (!cat) cat = await message.guild.channels.create({ name, type: 4 });
            createdCats[key] = cat;
        }

        const masterVCs = ["Make a Public VC", "Make a Private VC", "Join a Random VC", "Unmute Yourself"];
        for (const vcName of masterVCs) {
            if (!message.guild.channels.cache.find(c => c.name === vcName && c.parentId === createdCats.master.id)) {
                await message.guild.channels.create({ name: vcName, type: 2, parent: createdCats.master.id });
            }
        }

        await sendEmbed(message.channel, "success", "Voice Master setup complete!");
    }

    // -------------------- VM Reset Command --------------------
    if (cmd === "vmreset") {
        if (!member.permissions.has("ManageChannels")) return await sendEmbed(message.channel, "fail", "You need Manage Channels permission.");
        const categoriesToDelete = ["MAKE YOUR VOICE", "public vcs", "private vcs"];

        for (const catName of categoriesToDelete) {
            const cat = message.guild.channels.cache.find(c => c.name === catName && c.type === 4);
            if (cat) {
                cat.children.cache.forEach(async ch => {
                    await ch.delete().catch(() => {});
                });
                await cat.delete().catch(() => {});
            }
        }

        await sendEmbed(message.channel, "success", "Voice Master has been reset!");
    }
});

// --- Error Handling ---
process.on("unhandledRejection", console.error);
process.on("uncaughtException", console.error);

// --- Login ---
client.login(process.env.TOKEN);
