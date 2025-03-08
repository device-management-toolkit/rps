# Remote Provisioning Server

![CodeQL](https://img.shields.io/github/actions/workflow/status/open-amt-cloud-toolkit/rps/codeql-analysis.yml?style=for-the-badge&label=CodeQL&logo=github)
![API Tests](https://img.shields.io/github/actions/workflow/status/open-amt-cloud-toolkit/rps/api-test.yml?style=for-the-badge&label=API%20Test&logo=postman)
![Build](https://img.shields.io/github/actions/workflow/status/open-amt-cloud-toolkit/rps/node.js.yml?style=for-the-badge&logo=github)
![Codecov](https://img.shields.io/codecov/c/github/open-amt-cloud-toolkit/rps?style=for-the-badge&logo=codecov)
[![OSSF-Scorecard Score](https://img.shields.io/ossf-scorecard/github.com/open-amt-cloud-toolkit/rps?style=for-the-badge&label=OSSF%20Score)](https://api.securityscorecards.dev/projects/github.com/open-amt-cloud-toolkit/rps)
[![Discord](https://img.shields.io/discord/1063200098680582154?style=for-the-badge&label=Discord&logo=discord&logoColor=white&labelColor=%235865F2&link=https%3A%2F%2Fdiscord.gg%2FDKHeUNEWVH)](https://discord.gg/DKHeUNEWVH)
[![Docker Pulls](https://img.shields.io/docker/pulls/intel/oact-rps?style=for-the-badge&logo=docker)](https://hub.docker.com/r/intel/oact-rps)

> Disclaimer: Production viable releases are tagged and listed under 'Releases'. All other check-ins should be considered 'in-development' and should not be used in production

The Remote Provisioning Server (RPS) enables the configuration and activation of Intel® AMT devices based on a defined profile. RPS utilizes the [Remote Provision Client (RPC)](https://github.com/device-management-toolkit/rpc-go) deployed onto edge devices to connect the devices to the [Management Presence Server (MPS)](https://github.com/device-management-toolkit/mps) and enable remote manageability features.

<br><br>

**For detailed documentation** about Getting Started or other features of the Device Management Toolkit, see the [docs](https://device-management-toolkit.github.io/docs/).

<br>

## Prerequisites

To successfully deploy RPS, the following software must be installed on your development system:

- [Node.js\* LTS 18.x.x or newer](https://nodejs.org/en/)
- [git](https://git-scm.com/downloads)

## Deploy the Remote Provisioning Server (RPS) Microservice

To deploy the RPS on a local development system:

1. Clone the repo and switch to the `rps` directory.

   ```
   git clone https://github.com/device-management-toolkit/rps.git && cd rps
   ```

2. Install the dependencies from the working `rps` directory.

   ```bash
   npm install
   ```

3. Start the service.

   ```bash
   npm start
   ```

4. The RPS listens on port 8081 by default. Successful installation produces the command line message:

   ```
   RPS Microservice Rest APIs listening on https://:8081.
   ```

For detailed documentation about RPS, see the [docs](https://device-management-toolkit.github.io/docs/)

<br>

## Deploy with Docker and Run API Tests

We leverage [Postman](https://www.postman.com/) and Docker for executing RESTful API tests. Once you have Postman and Docker installed, you can follow the steps below:

1. Clone the repo and switch to the `rps` directory.

   ```
   git clone https://github.com/device-management-toolkit/rps.git && cd rps
   ```

2. Build the docker image.

   ```
   docker build -t rps-microservice:v1 .
   ```

3. Ensure RPS is running in a docker container.

   ```
   docker-compose up -d
   ```

4. Import the test collection located at `./src/test/collections/rps.postman_collection.json`.

5. Run the tests using the Collection Runner in postman. If any of the tests fail, file a github issue here: https://github.com/device-management-toolkit/rps/pull/34

<br>

## Using devcontainer

If you want debug in vscode devcontainer, try to open the project with devcontainer (Make sure you install the extension of **Dev Containers**)

- Step1: Press **Ctrl + Shift+ P** in vscode;
- Step2: Type **Dev Containers: Reopen in Container**;
- Step3: Click the item which appear in column;
- Step4: Open a terminal, build and run app with command;

<br>

## Additional Resources

- For detailed documentation and Getting Started, [visit the docs site](https://device-management-toolkit.github.io/docs).

- Looking to contribute? [Find more information here about contribution guidelines and practices](.\CONTRIBUTING.md).

- Find a bug? Or have ideas for new features? [Open a new Issue](https://github.com/device-management-toolkit/rps/issues).

- Need additional support or want to get the latest news and events about Open AMT? Connect with the team directly through Discord.

  [![Discord Banner 1](https://discordapp.com/api/guilds/1063200098680582154/widget.png?style=banner2)](https://discord.gg/DKHeUNEWVH)
