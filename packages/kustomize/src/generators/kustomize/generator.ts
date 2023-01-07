import {
  addProjectConfiguration,
  formatFiles,
  generateFiles,
  joinPathFragments,
  Tree,
  updateProjectConfiguration,
} from '@nrwl/devkit'
import { ProjectConfiguration } from 'nx/src/config/workspace-json-project-json'
import * as inquirer from 'inquirer'
import * as fs from 'fs'
import { KustomizeGeneratorSchema } from './schema';


export default async function (tree: Tree, schema: KustomizeGeneratorSchema) {
  let dependencies = []
  // Prompt for name
  if (!schema.name) {
    await inquirer
      .prompt([{ type: 'input', name: 'name', message: 'Which name would you like to use for that application ?' }])
      .then((answer) => {
        schema.name = answer.name
      })
  }

  // Prompt for namespace
  if (!schema.namespace) {
    await inquirer
      .prompt([
        {
          type: 'input',
          name: 'namespace',
          message: 'Which namespace would you like to use for that application ?',
          default: schema.name,
        },
      ])
      .then((answer) => {
        schema.namespace = answer.namespace
      })
  }
  // Prompt for dependencies
  if (!schema.dependencies) {
    await inquirer
      .prompt([
        {
          type: 'confirm',
          name: 'hasDependencies',
          message: 'Does that application has dependencies ?',
          default: false,
        },
      ])
      .then(async (answer) => {
        if (answer.hasDependencies) {
          const apps = getDirectories('apps')
          const deps = getCurrentDependencies(schema.name)
          await inquirer
            .prompt([
              {
                type: 'checkbox',
                name: 'dependencies',
                message: 'Choose dependencies:',
                choices: apps,
                default: deps,
              },
            ])
            .then((answers) => {
              dependencies = answers.dependencies
            })
        }
      })
  }

  // Prompt for overlays
  if (!schema.overlays) {
    const overlays = getCurrentOverlays(schema.name)
    await inquirer
      .prompt([
        {
          type: 'checkbox',
          name: 'overlays',
          message: 'Which overlays do you want to generate for that application ?',
          choices: ['gke-dev', 'k3d-dev', 'gke-qa', 'k3d-qa', 'gke-prod', 'k3d-prod', 'gke-ops', 'k3d-ops'],
          default: overlays,
        },
      ])
      .then(async (answer) => {
        schema.overlays = answer.overlays
      })
  }

  // Create the base directory
  let generateBase = true
  if (fs.existsSync(`./apps/${schema.name}/base`)) {
    await inquirer
      .prompt([{ type: 'confirm', name: 'overwrite', message: `Overwrite apps/${schema.name}/base ?`, default: false }])
      .then((answer) => {
        generateBase = answer.overwrite
      })
  }

  if (generateBase) {
    generateFiles(tree, joinPathFragments(__dirname, './files/base'), `./apps/${schema.name}/base`, {
      name: schema.name,
      namespace: schema.namespace,
    })
  }

  // Iterate on overlays
  for (const overlay of schema.overlays) {
    let generateOverlay = true
    if (fs.existsSync(`./apps/${schema.name}/overlays/${overlay}`)) {
      await inquirer
        .prompt([
          {
            type: 'confirm',
            name: 'overwrite',
            message: `Overwrite apps/${schema.name}/overlays/${overlay} ?`,
            default: false,
          },
        ])
        .then((answer) => {
          generateOverlay = answer.overwrite
        })
    }
    if (generateOverlay) {
      generateFiles(tree, joinPathFragments(__dirname, './files/overlays'), `./apps/${schema.name}/overlays`, {
        overlay: overlay,
        namespace: schema.namespace,
      })
    }
  }

  // Create or update the project.json
  const projectConfiguration = getProjectConfiguration(schema, dependencies)
  if (fs.existsSync(`./apps/${schema.name}/project.json`)) {
    updateProjectConfiguration(tree, schema.name, projectConfiguration)
  } else {
    addProjectConfiguration(tree, schema.name, projectConfiguration, true)
  }

  await formatFiles(tree)
}

function getProjectConfiguration(schema, dependencies) {
  const projectConfiguration: ProjectConfiguration = {
    name: schema.name,
    projectType: 'application',
    root: `apps/${schema.name}`,
    sourceRoot: `apps/${schema.name}`,
    implicitDependencies: dependencies,
    targets: {
      build: {
        executor: './tools/executors/build:kustomize',
        outputs: ['{options.outputPath}'],
        options: {
          outputPath: `dist/apps/${schema.name}`,
        },
      },
      test: {
        executor: './tools/executors/test:kubescape',
        dependsOn: ['build'],
        outputs: ['{options.outputPath}'],
        options: {
          inputPath: `dist/apps/${schema.name}`,
          outputPath: `dist/apps/${schema.name}/reports/test`,
          outputFormat: 'html',
        },
      },
      deploy: {
        executor: './tools/executors/deploy:kubernetes',
        dependsOn: ['^deploy', 'build'],
        outputs: ['{options.outputPath}'],
        options: {
          outputPath: `dist/apps/${schema.name}/reports/deploy`,
        },
      },
    },
  }

  projectConfiguration.targets['build'].configurations = schema.overlays.reduce((m, o) => {
    m[o] = { overlay: o }
    return m
  }, {})

  projectConfiguration.targets['test'].configurations = schema.overlays.reduce((m, o) => {
    m[o] = { inputPath: `dist/apps/${schema.name}/${o}.yaml` }
    return m
  }, {})

  projectConfiguration.targets['deploy'].configurations = schema.overlays.reduce((m, o) => {
    m[o] = { inputPath: `dist/apps/${schema.name}/${o}.yaml` }
    return m
  }, {})

  return projectConfiguration
}

function getDirectories(path) {
  return fs.readdirSync(path).filter(function (file) {
    return fs.statSync(path + '/' + file).isDirectory()
  })
}

function getCurrentDependencies(name: string) {
  let dependencies = []
  if (fs.existsSync(`apps/${name}/project.json`)) {
    const projectJson = JSON.parse(fs.readFileSync(`apps/${name}/project.json`).toString('utf-8'))
    dependencies = projectJson.implicitDependencies
  }
  return dependencies
}

function getCurrentOverlays(name: string) {
  let overlays = []
  if (fs.existsSync(`apps/${name}/overlays`)) {
    overlays = fs.readdirSync(`apps/${name}/overlays`)
  }
  return overlays
}
