const { Client, GatewayIntentBits, EmbedBuilder } = require("discord.js");
const { emojis, prefix } = require("./config");
require("./keep_alive"); // Keep-alive server

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.GuildVoiceStates,
        GatewayIntentBits.MessageContent
    ]
});

// --- Embed Helper ---
async function sendEmbed(channel, type, description) {
    const embed = new EmbedBuilder()
        .setTitle(type === "success" ? `${emojis.success} Success!` : `${emojis.fail} Error!`)
        .setDescription(description)
        .setColor(type === "success" ? "Green" : "Red")
        .setTimestamp();
    await channel.send({ embeds: [embed] });
}

// --- In-memory storage of master category IDs per guild ---
const guildVMs = new Map();

// --- On Ready ---
client.once("ready", () => {
    console.log(`${client.user.tag} is online!`);
});

// --- Voice State Handling ---
client.on("voiceStateUpdate", async (oldState, newState) => {
    const guild = newState.guild;
    if (!guild) return;

    const vmData = guildVMs.get(guild.id);
    if (!vmData) return;

    const { masterCatId, publicCatId, privateCatId } = vmData;

    const masterCat = guild.channels.cache.get(masterCatId);
    const publicCat = guild.channels.cache.get(publicCatId);
    const privateCat = guild.channels.cache.get(privateCatId);

    // --- Temp Public VC ---
    const joinPublicVC = masterCat?.children.find(ch => ch.type === 2 && ch.name.toLowerCase().includes("join") && ch.name.toLowerCase().includes("public"));
    if (newState.channel?.id === joinPublicVC?.id) {
        if (!publicCat) return;
        const tempVC = await guild.channels.create({
            name: `${newState.member.user.username}’s Public VC`,
            type: 2,
            parent: publicCat.id,
            permissionOverwrites: [{ id: guild.id, allow: ["Connect", "ViewChannel"] }]
        });
        await newState.setChannel(tempVC);
    }

    // --- Temp Private VC ---
    const joinPrivateVC = masterCat?.children.find(ch => ch.type === 2 && ch.name.toLowerCase().includes("join") && ch.name.toLowerCase().includes("private"));
    if (newState.channel?.id === joinPrivateVC?.id) {
        if (!privateCat) return;
        const tempVC = await guild.channels.create({
            name: `${newState.member.user.username}’s Private VC`,
            type: 2,
            parent: privateCat.id,
            permissionOverwrites: [
                { id: guild.id, deny: ["Connect"] },
                { id: newState.member.id, allow: ["Connect", "ViewChannel", "ManageChannels", "MuteMembers"] }
            ]
        });
        await newState.setChannel(tempVC);
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
    if (!message.content.startsWith(prefix)) return;

    const args = message.content.slice(prefix.length).trim().split(/ +/);
    const cmd = args.shift().toLowerCase();
    const member = message.member;
    const vc = member.voice.channel;

    const vmData = guildVMs.get(message.guild.id);

    // -------------------- VC Commands --------------------
    if (cmd === "vc") {
        const sub = args[0]?.toLowerCase();
        if (!sub) return await sendEmbed(message.channel, "fail", "Specify a subcommand.");
        if (!vc && sub !== "unmute") return await sendEmbed(message.channel, "fail", "You must be in a VC.");

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
                    .setTitle(`${emojis.success} VC Info`)
                    .setDescription(`Name: ${vc.name}\nOwner: <@${ownerId}>\nMembers: ${vc.members.size}\nUser Limit: ${vc.userLimit || "None"}`)
                    .setColor("Blue")
                    .setTimestamp();
                await message.channel.send({ embeds: [infoEmbed] });
                break;

            case "unmute":
                await member.voice.setMute(false);
                await sendEmbed(message.channel, "success", "You are now unmuted!");
                break;
        }
    }

    // -------------------- VM Setup Command --------------------
    if (cmd === "vmsetup") {
        if (!member.permissions.has("ManageChannels")) return await sendEmbed(message.channel, "fail", "You need Manage Channels permission.");

        const categories = { master: "Voice Master", public: "Public VC", private: "Private VC" };
        const createdCats = {};

        for (const [key, name] of Object.entries(categories)) {
            let cat = message.guild.channels.cache.find(c => c.name === name && c.type === 4);
            if (!cat) cat = await message.guild.channels.create({ name, type: 4 });
            createdCats[key] = cat;
        }

        const masterVCs = ["Join to Make Public", "Join to Make Private", "Join random VC", "unmute yourself"];
        for (const vcName of masterVCs) {
            if (!createdCats.master.children.cache.find(c => c.name === vcName)) {
                await message.guild.channels.create({ name: vcName, type: 2, parent: createdCats.master.id });
            }
        }

        guildVMs.set(message.guild.id, {
            masterCatId: createdCats.master.id,
            publicCatId: createdCats.public.id,
            privateCatId: createdCats.private.id
        });

        await sendEmbed(message.channel, "success", "Voice Master setup complete!");
    }

    // -------------------- VM Reset Command --------------------
    if (cmd === "vmreset") {
        if (!member.permissions.has("ManageChannels")) return await sendEmbed(message.channel, "fail", "You need Manage Channels permission.");

        const vmData = guildVMs.get(message.guild.id);
        if (!vmData) return await sendEmbed(message.channel, "fail", "Voice Master is not set up.");

        const { masterCatId, publicCatId, privateCatId } = vmData;
        const categoriesToDelete = [masterCatId, publicCatId, privateCatId];

        for (const catId of categoriesToDelete) {
            const cat = message.guild.channels.cache.get(catId);
            if (cat) {
                cat.children.cache.forEach(async ch => {
                    await ch.delete().catch(() => {});
                });
                await cat.delete().catch(() => {});
            }
        }

        guildVMs.delete(message.guild.id);
        await sendEmbed(message.channel, "success", "Voice Master has been reset!");
    }
});

// --- Error Handling ---
process.on("unhandledRejection", console.error);
process.on("uncaughtException", console.error);

// --- Login ---
client.login(process.env.TOKEN);
