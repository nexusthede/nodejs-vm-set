const { Client, GatewayIntentBits, MessageEmbed } = require("discord.js");
const { emojis, prefix } = require("./config"); // config.js
const keepAlive = require("./keep_alive"); // keep-alive server

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.GuildVoiceStates,
        GatewayIntentBits.MessageContent
    ]
});

// Embed helper
function sendEmbed(channel, type, description) {
    const embed = new MessageEmbed()
        .setTitle(type === "success" ? `${emojis.success} Success!` : `${emojis.fail} Error!`)
        .setDescription(description)
        .setColor(type === "success" ? "GREEN" : "RED");
    channel.send({ embeds: [embed] });
}

// On ready
client.once("ready", async () => {
    console.log(`${client.user.tag} is online!`);
    // Create Master, Public, Private categories if not exist
    client.guilds.cache.forEach(async guild => {
        let masterCat = guild.channels.cache.find(c => c.name === "Voice Master" && c.type === 4);
        let publicCat = guild.channels.cache.find(c => c.name === "Public VC" && c.type === 4);
        let privateCat = guild.channels.cache.find(c => c.name === "Private VC" && c.type === 4);

        if (!masterCat) masterCat = await guild.channels.create({ name: "Voice Master", type: 4 });
        if (!publicCat) publicCat = await guild.channels.create({ name: "Public VC", type: 4 });
        if (!privateCat) privateCat = await guild.channels.create({ name: "Private VC", type: 4 });

        // Create Master VCs if not exist
        const masterVCs = ["Join to Make Public", "Join to Make Private", "Join random Vc", "unmute urself"];
        for (const vcName of masterVCs) {
            if (!guild.channels.cache.find(c => c.name === vcName && c.parentId === masterCat.id)) {
                await guild.channels.create({ name: vcName, type: 2, parent: masterCat.id });
            }
        }
    });
});

// Voice state handling for temporary VCs
client.on("voiceStateUpdate", async (oldState, newState) => {
    const guild = newState.guild;
    const masterCat = guild.channels.cache.find(c => c.name === "Voice Master" && c.type === 4);
    const publicCat = guild.channels.cache.find(c => c.name === "Public VC" && c.type === 4);
    const privateCat = guild.channels.cache.find(c => c.name === "Private VC" && c.type === 4);

    // Handle joining "Join to Make Public" VC
    if (newState.channel && newState.channel.name === "Join to Make Public") {
        const tempVC = await guild.channels.create({
            name: "@user’s channel",
            type: 2,
            parent: publicCat.id,
            permissionOverwrites: [
                { id: guild.id, allow: ["Connect", "ViewChannel"] }
            ]
        });
        newState.setChannel(tempVC);
    }

    // Handle joining "Join to Make Private" VC
    if (newState.channel && newState.channel.name === "Join to Make Private") {
        const tempVC = await guild.channels.create({
            name: "@user’s channel",
            type: 2,
            parent: privateCat.id,
            permissionOverwrites: [
                { id: guild.id, deny: ["Connect"] }, // only owner allowed
                { id: newState.id, allow: ["Connect", "ViewChannel", "ManageChannels", "MuteMembers"] }
            ]
        });
        newState.setChannel(tempVC);
    }

    // Delete empty temporary VCs
    if (oldState.channel && oldState.channel.parentId && 
        (oldState.channel.parentId === publicCat?.id || oldState.channel.parentId === privateCat?.id) &&
        oldState.channel.members.size === 0) {
        oldState.channel.delete().catch(() => {});
    }
});

// Prefix command handling
client.on("messageCreate", async message => {
    if (!message.guild || message.author.bot) return;
    if (!message.content.startsWith(prefix)) return;

    const args = message.content.slice(prefix.length).trim().split(/ +/);
    const cmd = args.shift().toLowerCase();
    const member = message.member;
    const vc = member.voice.channel;

    if (!vc) return sendEmbed(message.channel, "fail", "You must be in a voice channel to use VC commands.");

    const ownerId = vc.members.firstKey(); // first user is owner

    switch (cmd) {
        case "vc":
            const sub = args[0]?.toLowerCase();
            if (!sub) return sendEmbed(message.channel, "fail", "Specify a subcommand.");

            if (sub === "lock") {
                if (member.id !== ownerId) return sendEmbed(message.channel, "fail", "Only the owner can lock VC.");
                await vc.permissionOverwrites.edit(message.guild.id, { Connect: false });
                sendEmbed(message.channel, "success", "VC has been locked.");
            }
            else if (sub === "unlock") {
                if (member.id !== ownerId) return sendEmbed(message.channel, "fail", "Only the owner can unlock VC.");
                await vc.permissionOverwrites.edit(message.guild.id, { Connect: true });
                sendEmbed(message.channel, "success", "VC has been unlocked.");
            }
            else if (sub === "kick") {
                if (member.id !== ownerId) return sendEmbed(message.channel, "fail", "Only the owner can kick users.");
                const target = message.mentions.members.first();
                if (!target) return sendEmbed(message.channel, "fail", "Mention a user to kick.");
                if (!vc.members.has(target.id)) return sendEmbed(message.channel, "fail", "User is not in your VC.");
                await target.voice.disconnect();
                sendEmbed(message.channel, "success", `${target.user.tag} has been kicked.`);
            }
            else if (sub === "unmute") {
                await member.voice.setMute(false);
                sendEmbed(message.channel, "success", "You are now unmuted!");
            }
            // Additional commands: ban, permit, limit, info, rename, transfer can be added similarly
            break;
    }
});

// Error handling
process.on("unhandledRejection", console.error);
process.on("uncaughtException", console.error);

// Login
client.login(process.env.TOKEN);
