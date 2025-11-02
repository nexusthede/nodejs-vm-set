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

// --- In-memory storage for guild VMs ---
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

    const { masterCatId, publicCatId, privateCatId, joinPublicId, joinPrivateId } = vmData;

    const publicCat = guild.channels.cache.get(publicCatId);
    const privateCat = guild.channels.cache.get(privateCatId);

    // --- Temp Public VC ---
    if (newState.channel?.id === joinPublicId) {
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
    if (newState.channel?.id === joinPrivateId) {
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

        // Create categories dynamically
        const masterCat = await message.guild.channels.create({ name: "Voice Master", type: 4 });
        const publicCat = await message.guild.channels.create({ name: "Public VC", type: 4 });
        const privateCat = await message.guild.channels.create({ name: "Private VC", type: 4 });

        // Create join channels inside master (you can rename these later)
        const joinPublicVC = await message.guild.channels.create({ name: "Join to Make Public", type: 2, parent: masterCat.id });
        const joinPrivateVC = await message.guild.channels.create({ name: "Join to Make Private", type: 2, parent: masterCat.id });

        // Store IDs for dynamic temp VC handling
        guildVMs.set(message.guild.id, {
            masterCatId: masterCat.id,
            publicCatId: publicCat.id,
            privateCatId: privateCat.id,
            joinPublicId: joinPublicVC.id,
            joinPrivateId: joinPrivateVC.id
        });

        await sendEmbed(message.channel, "success", "Voice Master setup complete! You can rename categories or channels freely.");
    }

    // -------------------- VM Reset Command --------------------
    if (cmd === "vmreset") {
        if (!member.permissions.has("ManageChannels")) return await sendEmbed(message.channel, "fail", "You need Manage Channels permission.");

        const vmData = guildVMs.get(message.guild.id);
        if (!vmData) return await sendEmbed(message.channel, "fail", "No Voice Master setup found.");

        const { masterCatId, publicCatId, privateCatId } = vmData;
        [masterCatId, publicCatId, privateCatId].forEach(catId => {
            const cat = message.guild.channels.cache.get(catId);
            if (!cat) return;
            if (cat.children) cat.children.cache.forEach(ch => ch.delete().catch(() => {}));
            cat.delete().catch(() => {});
        });

        guildVMs.delete(message.guild.id);
        await sendEmbed(message.channel, "success", "Voice Master has been reset!");
    }
});

// --- Error Handling ---
process.on("unhandledRejection", console.error);
process.on("uncaughtException", console.error);

// --- Login ---
client.login(process.env.TOKEN);
