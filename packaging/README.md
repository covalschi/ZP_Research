# packaging

What a published `@Mod` folder needs besides the packed pbo. The `@Mod` folders are build
output and are not in git; this repository has no `package.ps1`, so the files here are copied
into `@ZP_Research/` and `@ZP_Research_VPP/` by hand before a publish.

```
packaging/<Mod>/meta.cpp    the Workshop item id -- copy it into @<Mod>/ before publishing,
                            or the next upload creates a SECOND item instead of updating
packaging/<Mod>.workshop.bbcode
                            the Workshop listing: the description the item's page shows,
                            English and Ukrainian in one field, Steam BBCode. Beside the
                            folder, not inside it, so it is never shipped as a file of the mod
```

Publishing goes through the `dayz` MCP: `workshop_publish("<Mod>")` uploads the `@Mod` folder
to the item `meta.cpp` names; `workshop_publish("<Mod>", description=<the text of
packaging/<Mod>.workshop.bbcode>, tags=[...], content=False)` updates the listing without
touching the files. Steam replaces the whole tag list on every such call; the tags each item
carries:

| item | tags |
|---|---|
| ZP_Research (3802266917) | Mod, Mechanics, Equipment |
| ZP_Research_VPP (3802267228) | Mod, Mechanics |
