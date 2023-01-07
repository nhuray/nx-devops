import {ExecutorContext} from '@nrwl/devkit'
import * as execa from 'execa'
import * as glob from 'glob'
import * as fs from 'fs'
import {ensureDirSync, removeSync} from 'fs-extra'
import * as path from 'path'
import * as chalk from 'chalk'

const error = chalk.bold.red
const warn = chalk.yellow

import {BuildExecutorSchema} from './schema';

export default async function runExecutor(
  options: BuildExecutorSchema,
  context: ExecutorContext
): Promise<{ success: boolean }> {
  if (!options.outputPath) {
    throw new Error("Please set option 'outputPath'.")
  }

  if (!options.overlaysPath) {
    options.overlaysPath = path.join(context.cwd, 'overlays')
  }

  if (options.overlay) {
    const overlayKustomization = path.join(options.overlaysPath, options.overlay, 'kustomization.yaml')
    if (!fs.existsSync(overlayKustomization)) {
      console.log(warn(`Overlay '${options.overlay}' not found. Skipping build...`))
      return {success: true}
    }
  }

  // Delete output path before building
  if (options.deleteOutputPath) {
    deleteOutputDir(context.root, options.outputPath)
  }
  ensureDirSync(path.join(context.root, options.outputPath))

  try {
    const success = await kustomizeBuild(options, context)
    return {success}
  } catch (e) {
    if (context.isVerbose) {
      console.error(error(e))
    }
    throw new Error(`ERROR: Something went wrong in kustomize build - ${e.message}`)
  }
}

async function kustomizeBuild(options: BuildExecutorSchema, context: ExecutorContext) {
  const overlay = options.overlay ? options.overlay : '*'
  const inputGlobPath = path.join(options.overlaysPath, `${overlay}/kustomization.yaml`)
  const command = 'kustomize build --load-restrictor LoadRestrictionsNone --enable-alpha-plugins'

  // Run kustomize build for each kustomization.yaml file found
  const commands = glob.sync(inputGlobPath).map((kustomization) => {
    const cwd = path.dirname(kustomization)
    const overlay = path.basename(cwd)
    const outputFile = path.join(context.root, options.outputPath, `${overlay}.yaml`)
    const cmd = [command, cwd].join(' ')
    return new Promise((resolve, _) => {
      printCommand(cmd, context)
      const {stdout} = execa.commandSync(cmd, {cwd: context.root, shell: true})
      writeOutput(stdout, outputFile, context)
      resolve(true)
    })
  })

  // Execute commands in parallel
  const r = await Promise.all(commands)
  const failed = r.filter((command) => command.failed)
  if (failed.length > 0) {
    failed.forEach((f) => {
      console.error(`Warning: "${f.escapedCommand}" exited with non-zero status code`)
    })
    return false
  } else {
    return true
  }
}

/**
 * Delete an output directory, but error out if it's the root of the project.
 */
export function deleteOutputDir(root: string, outputPath: string) {
  const resolvedOutputPath = path.resolve(root, outputPath)
  if (resolvedOutputPath === root) {
    throw new Error('Output path MUST not be project root directory!')
  }
  removeSync(resolvedOutputPath)
}

export function printCommand(command: string, context: ExecutorContext) {
  console.log(`${chalk.blueBright('>')} ${chalk.bgBlueBright(' Kustomize ')}  ${chalk.grey(command)}`)
}

export function writeOutput(stdout: string, outputFile: string, context: ExecutorContext) {
  fs.writeFileSync(outputFile, stdout)
  if (context.isVerbose) {
    console.log(stdout)
  }
}
