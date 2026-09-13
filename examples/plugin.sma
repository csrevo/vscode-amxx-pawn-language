#include <amxmodx>

#define PLUGIN_NAME "Revo Example"
#define PLUGIN_VERSION "1.0.0"

public plugin_init()
{
    register_plugin(PLUGIN_NAME, PLUGIN_VERSION, "Revo");
    register_clcmd("say /revo", "cmd_revo");
}

/**
 * Sends a greeting to the player.
 * @param id Player index.
 * @return PLUGIN_HANDLED.
 */
public cmd_revo(id)
{
    client_print(id, print_chat, "Revo Pawn is ready.");
    return PLUGIN_HANDLED;
}
