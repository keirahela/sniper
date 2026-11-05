import { once } from 'node:events';
import { Client, Events, GatewayIntentBits, PermissionFlagsBits } from 'discord.js';

export function alertPayload(config, post) {
  return {
    content: `<@${config.userId}> New video post from @${config.username}\n${post.url}`,
    allowedMentions: { parse: [], users: [config.userId] },
    nonce: post.id,
    enforceNonce: true,
  };
}

export async function connectDiscord(config) {
  const client = new Client({ intents: [GatewayIntentBits.Guilds], rest: { timeout: 30000 } });
  client.on(Events.Error, error => console.error('Discord client:', error.message));
  try {
    const ready = once(client, Events.ClientReady, { signal: AbortSignal.timeout(45000) });
    // Attach both handlers immediately so a login failure cannot leave an unhandled ready timeout.
    await Promise.all([ready, client.login(config.discordToken)]);
    const channel = await client.channels.fetch(config.channelId);
    if (!channel?.isTextBased() || !channel.isSendable() || !channel.guild || channel.isThread()) {
      throw new Error('DISCORD_CHANNEL_ID must be a regular server text channel the bot can send to.');
    }
    const permissions = channel.permissionsFor(client.user);
    if (!permissions?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages])) {
      throw new Error('Give the bot View Channel and Send Messages in the alert channel.');
    }
    await channel.guild.members.fetch(config.userId);
    return { client, channel, send: (post, accountConfig = config) => channel.send(alertPayload(accountConfig, post)) };
  } catch (error) {
    client.destroy();
    throw error;
  }
}
