# Zellij Layouts Reference

## Loading Layouts

```bash
# Start with layout
zellij --layout my-layout

# Create new tab with layout
zellij action new-tab -l my-layout

# Dump current layout
zellij action dump-layout > layout.kdl
```

## Layout File Format (KDL)

```kdl
// ~/.config/zellij/layouts/dev.kdl
layout {
    // Default tab template
    default_tab_template {
        pane size=1 borderless=true {
            plugin location="zellij:tab-bar"
        }
        children
        pane size=2 borderless=true {
            plugin location="zellij:status-bar"
        }
    }

    // First tab - code editing
    tab name="Code" focus=true {
        pane split_direction="vertical" {
            pane command="nvim" {
                args "."
            }
            pane split_direction="horizontal" size="30%" {
                pane command="lazygit"
                pane name="Terminal"
            }
        }
    }

    // Second tab - services
    tab name="Services" {
        pane split_direction="horizontal" {
            pane command="npm" {
                args "run" "dev"
                cwd "/path/to/frontend"
            }
            pane command="npm" {
                args "run" "dev"
                cwd "/path/to/backend"
            }
        }
    }
}
```

## Floating Panes in Layouts

```kdl
layout {
    tab {
        pane
        floating_panes {
            pane command="htop" {
                x 10%
                y 10%
                width "60%"
                height "60%"
            }
        }
    }
}
```

## Stacked Panes

```kdl
layout {
    tab {
        pane stacked=true {
            pane command="tail" {
                args "-f" "/var/log/app.log"
                name "App Logs"
            }
            pane command="tail" {
                args "-f" "/var/log/system.log"
                name "System Logs"
            }
            pane command="tail" {
                args "-f" "/var/log/error.log"
                name "Error Logs"
            }
        }
        pane  // Main working pane
    }
}
```

## Session Configuration in Layouts

```kdl
layout {
    // Attach to existing session or create new one
    session name="dev-session"

    tab name="Editor" {
        pane command="nvim"
    }
}
```
