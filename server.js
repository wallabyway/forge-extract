const fs = require('fs');
const path = require('path');
const express = require('express');
const fetch = require('node-fetch');

const { deserialize } = require('./src/readers/svf');
const { serialize } = require('./src/writers/gltf')

const ForgeUrl = 'https://developer.api.autodesk.com';

let app = express();

function createFolders(folder) {
    folder.split('/').reduce((accumulator, current) => {
        if (accumulator && !fs.existsSync(accumulator)) {
            fs.mkdirSync(accumulator);
        }
        return accumulator + '/' + current;
    });
    if (!fs.existsSync(folder)) {
        fs.mkdirSync(folder);
    }
}

function findViewables(manifest, mime) {
    function traverse(node, callback) {
        callback(node);
        node.derivatives && node.derivatives.forEach(child => traverse(child, callback));
        node.children && node.children.forEach(child => traverse(child, callback));
    }

    let viewables = [];
    traverse(manifest, function(node) { if (node.mime === mime) viewables.push(node); });
    return viewables;
}

// GET /:urn
// Lists GUIDs of all 3D viewables in an URN.
// Requires "Authorization" header with Forge access token.
app.get('/:urn', async function(req, res) {
    try {
        const { urn } = req.params;
        const url = `${ForgeUrl}/modelderivative/v2/designdata/${urn}/manifest`;
        const response = await fetch(url, { headers: { Authorization: req.headers.authorization }  });
        if (response.status !== 200) {
            const message = await response.buffer();
            res.status(response.status).json({ message });
            return;
        }
        const manifest = await response.json();
        res.json(findViewables(manifest, 'application/autodesk-svf').map(viewable => viewable.guid));
    } catch(error) {
        console.error(error);
        res.status(500).json(error);
    }
});

// Intercepts all requests to /:urn/:guid/*,
// triggering SVF-to-GLTF translation if the output is not yet available.
app.use('/:urn/:guid', async function(req, res, next) {
    try {
        const { urn, guid } = req.params;
        const folder = path.join(__dirname, 'cache', urn, guid);
        if (!fs.existsSync(folder)) {
            createFolders(folder);
            const logfile = path.join(folder, 'output.log');
            function log(msg) { fs.appendFileSync(logfile, `[${new Date().toString()}] ${msg}\n`); };
            const token = req.headers.authorization.replace('Bearer ', '');
            const model = await deserialize(urn, token, guid, log);
            serialize(model, path.join(folder, 'output'));
            fs.writeFileSync(path.join(folder, 'props.db'), model.propertydb); // TODO: store property db just once per URN
        }
        next();
    } catch(error) {
        console.error(error);
        res.status(500).json(error);
    }
});

// GET /:urn/:guid
// Lists all files available for a 3D viewable GUID.
// Requires "Authorization" header with Forge access token.
app.get('/:urn/:guid', function(req, res) {
    const { urn, guid } = req.params;
    const folder = path.join(__dirname, 'cache', urn, guid);
    if (fs.existsSync(folder)) {
        res.json(fs.readdirSync(folder));
    } else {
        res.status(404).end();
    }
});

// GET /:urn/:guid/:resource
// Returns raw data of a specific resource of a 3D viewable GUID.
// Requires "Authorization" header with Forge access token.
app.get('/:urn/:guid/:resource', function(req, res) {
    const { urn, guid, resource } = req.params;
    const folder = path.join(__dirname, 'cache', urn, guid);
    const file = path.join(folder, resource);
    if (fs.existsSync(file)) {
        res.sendFile(file);
    } else {
        res.status(404).end();
    }
});

const port = process.env.PORT || 3000;
app.listen(port, () => { console.log(`Server listening on port ${port}`); });