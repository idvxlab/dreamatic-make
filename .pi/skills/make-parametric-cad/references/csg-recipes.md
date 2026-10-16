# Make CSG Recipes and Tool Limits

Tool call: `cad_generate({name:"enclosure", recipeJson: JSON.stringify(recipe)})`. The name must start with an ASCII letter and contain only letters, digits, underscores, or hyphens, up to 60 characters. Dimensions are millimeters; rotation angles are degrees.

A recipe contains optional numeric parameters and geometry. Dimension positions accept parameter references such as `$width`, but not expressions such as `$width-4`. Define related dimensions as separate parameters.

| op | Fields | Convention |
| --- | --- | --- |
| box | size: [x,y,z] | Positive dimensions, centered at the origin |
| cylinder | radius, height, optional segments | Positive dimensions, centered on the Z axis; segments is an integer from 12 to 64, default 32 |
| translate | value: [x,y,z], child | Translate child geometry |
| rotate | value: [x,y,z], child | Rotate around each axis in degrees |
| union / subtract / intersect | children: [...] | 2–12 children; subtract removes subsequent children from the first |

Example open enclosure:

```json
{
  "parameters": {"width":60,"depth":40,"height":20,"innerWidth":56,"innerDepth":36},
  "geometry": {
    "op":"subtract",
    "children":[
      {"op":"box","size":["$width","$depth","$height"]},
      {"op":"translate","value":[0,0,2],"child":{"op":"box","size":["$innerWidth","$innerDepth",20]}}
    ]
  }
}
```

This is a geometry example only. It includes no screws, mounting holes, or verified tolerances. Generate parts separately and save assembly relationships in Context.

Each recipe supports at most 80 parameters, 100 geometry nodes, and depth 9, with an absolute numeric limit of 10000. Generation runs in an isolated Worker with a 30-second timeout and 256 MB heap limit. It returns four artifacts: JSON recipe, OpenSCAD, STL, and an inspection report. Reports cover geometry checks, volume, and bounds; they do not prove freedom from all self-intersections, print orientation, tolerances, slicing, or strength.
