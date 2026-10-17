# Layout for the install disk image (built with dmgbuild: `dmgbuild -s dmg-settings.py "Misfit Creatives" out.dmg`).
import os
app = ".dist/Misfit Creatives-darwin-arm64/Misfit Creatives.app"
format = "UDZO"
files = [app]
symlinks = {"Applications": "/Applications"}
icon = "icon.icns"
background = "dmg-background.png"
window_rect = ((200, 120), (660, 400))
icon_size = 112
text_size = 14
icon_locations = {"Misfit Creatives.app": (180, 215), "Applications": (480, 215)}
default_view = "icon-view"
show_status_bar = False
show_tab_view = False
show_toolbar = False
show_pathbar = False
show_sidebar = False
