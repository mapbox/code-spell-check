#!/usr/bin/env node

const dictionary = require('dictionary-en-us');
const spell = require('retext-spell');
const report = require('vfile-reporter');
const babylon = require('babylon');
const traverse = require('babel-traverse').default;
const fs = require('fs');
const pify = require('pify');
const pAll = require('p-all');
const vfile = require('vfile');
const u = require('unist-builder');
const unified = require('unified');
const English = require('parse-english');

const personal = `
Mapbox
Styleguide
ViewController
MGLMapView
SDK
SDKs
build.gradle
geocoding
APIs
Webpack
Browserify
npm
bundler
SLA
GL
JS
CSS
MGLMapboxAccessToken
Info.plist
iOS
`;

const opts = {
  allowImportExportEverywhere: true,
  sourceType: 'module',
  plugins: [
    'jsx',
    'flow',
    'asyncFunctions',
    'classConstructorCall',
    'doExpressions',
    'trailingFunctionCommas',
    'objectRestSpread',
    'decorators',
    'classProperties',
    'exportExtensions',
    'exponentiationOperator',
    'asyncGenerators',
    'functionBind',
    'functionSent'
  ]
};

const englishParser = new English();
const sortByRange = (a, b) => a.range[0] - b.range[0];

const addSourceNode = (source, start, end) => ({
  type: 'SourceNode',
  value: source.slice(start, end),
  range: [start, end]
});

const addParagraphNode = node => ({
  type: 'ParagraphNode',
  children: englishParser.parse(node.value).children,
  range: [node.start, node.end]
});

function astToNlcst(ast, source) {
  const englishChunks = [];
  traverse(ast, {
    JSXText(path) {
      englishChunks.push(addParagraphNode(path.node));
    },
    TemplateElement(path) {
      const stringValue = path.node.value.raw;
      if ((stringValue.match(/\n/g) || []).length > 2 || stringValue.match(/[A-Z]/)) {
        englishChunks.push(addParagraphNode(path.node));
      }
    }
  });
  englishChunks.sort(sortByRange);

  if (!englishChunks.length) {
    return;
  }

  const gaps = [];
  if (englishChunks[0].range[0] !== 0) {
    gaps.push(addSourceNode(source, 0, englishChunks[0].range[0] - 1));
  }
  for (let i = 0; i < englishChunks.length - 1; i++) {
    gaps.push(addSourceNode(source, englishChunks[i].range[1] + 1, englishChunks[i + 1].range[0] - 1));
  }
  if (englishChunks[englishChunks.length - 1].range[1] !== source.length) {
    gaps.push(addSourceNode(source, englishChunks[englishChunks.length - 1].range[1] + 1, source.length));
  }

  return {
    type: 'RootNode',
    children: englishChunks.concat(gaps).sort(sortByRange)
  };
}

function codeSpellCheck(inputs) {
  return pAll(
    inputs.map(filename => {
      return () =>
        pify(fs.readFile)(filename, 'utf8')
          .then(source => {
            const tree = astToNlcst(babylon.parse(source, opts), source);

            if (!tree) {
              return Promise.resolve(undefined);
            }

            return new Promise((resolve, reject) => {
              unified()
                .use(spell, {
                  dictionary,
                  personal
                })
                .run(
                  tree,
                  {
                    path: filename
                  },
                  function(err, tree, file) {
                    resolve(file);
                  }
                );
            });
          })
          .then(file => {
            if (file && file.messages.length) return Promise.resolve(file);
          });
    }),
    {
      concurrency: 5
    }
  )
    .then(vfiles => {
      const filesWithMessages = vfiles.filter(v => v);
      console.error(report(filesWithMessages));
    })
    .catch(err => {
      console.log(err);
      console.log(err.stack);
    });
}

module.exports = codeSpellCheck;

if (require.main == module) {
  codeSpellCheck(process.argv.slice(2));
}
