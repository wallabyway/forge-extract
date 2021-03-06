const path = require('path');
const fs = require('fs');
const program = require('commander');

const { version } = require('./package.json');
const { deserialize } = require('./src/readers/svf');
const { serialize } = require('./src/writers/gltf');
const { getManifest, traverseManifest } = require('./src/helpers/forge');

async function convertToGltf(urn, guid, token, folder) {
    console.log('Converting to gltf');

    const outputFolder = path.join(folder, 'gltf');
    if (!fs.existsSync(outputFolder)) fs.mkdirSync(outputFolder);

    const model = await deserialize(urn, token, guid, console.log);
    serialize(model, path.join(outputFolder, 'output'));
    fs.writeFileSync(path.join(outputFolder, 'props.db'), model.propertydb); // TODO: store property db just once per URN
}

async function convertViewable(urn, guid, token, folder, format) {
    console.log('Viewable GUID', guid);

    const viewableFolder = path.join(folder, guid);
    if (!fs.existsSync(viewableFolder)) fs.mkdirSync(viewableFolder);

    switch (format) {
        case 'gltf':
            await convertToGltf(urn, guid, token, viewableFolder)
            break;
        default:
            console.warn('Output type not supported.');
            break;
    }
}

async function convertUrn(urn, guid, token, folder, format) {
    console.log('URN', urn);

    const outputFolder = path.resolve(__dirname, folder);
    if (!fs.existsSync(outputFolder)) fs.mkdirSync(outputFolder);
    const urnFolder = path.join(outputFolder, urn);
    if (!fs.existsSync(urnFolder)) fs.mkdirSync(urnFolder);

    if (guid) {
        await convertViewable(urn, guid, token, urnFolder, format);
    } else {
        const manifest = await getManifest(urn, token);
        const guids = [];
        traverseManifest(manifest, function(node) {
            if (node.mime === 'application/autodesk-svf') {
                guids.push(node.guid);
            }
        });
        for (const guid of guids) {
            await convertViewable(urn, guid, token, urnFolder, format);
        }
    }
}

program
    .version(version, '-v, --version')
    .option('-a, --access-token [token]', 'Forge access token (can also be provided via FORGE_ACCESS_TOKEN env. var.)', '')
    .option('-o, --output-folder [folder]', 'output folder', '.')
    .option('-t, --output-type [type]', 'output file format (gltf)', 'gltf')
    .arguments('<urn> [guid]')
    .action(function(urn, guid) {
        const token = program.accessToken || process.env.FORGE_ACCESS_TOKEN;
        if (!token) {
            console.warn('Forge access token missing.');
            return;
        }
        convertUrn(urn, guid, token, program.outputFolder, program.outputType)
            .then(_ => console.log('Done!'))
            .catch(err => console.error(err));
    })
    .parse(process.argv);

if (program.args.length === 0) {
    program.help();
}