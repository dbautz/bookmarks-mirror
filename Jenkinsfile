// dbautz/bookmarks-mirror — test every push; submit to AMO (listed) on a version bump.
//
// The trigger is the version in src/manifest.json having no Gitea release yet, not a
// tag or a parameter. AMO refuses a version number twice on any channel, so "one
// release per version" is a constraint we inherit anyway — the bump is the button.
//
// AMO hosts and signs the listed .xpi after review, so nothing here waits for or
// downloads it. The Gitea release is the record that a version was submitted, with
// the exact source zip the reviewers got.
pipeline {
    agent { label 'jenkins-agent' }

    triggers {
        // Per-repo Gitea push hook -> /generic-webhook-trigger/invoke?token=<token>,
        // same shape as the rest of the fleet. Repo NAME in the regex, not owner/name:
        // an org transfer changes repository.full_name and silentResponse hides it.
        GenericTrigger(
            genericVariables: [[key: 'repo', value: '$.repository.full_name']],
            tokenCredentialId: 'bookmarks-mirror-webhook-token',
            causeString: 'Push to $repo',
            regexpFilterText: '$repo',
            regexpFilterExpression: '^[^/]+/bookmarks-mirror$',
            printContributedVariables: false,
            printPostContent: false,
            silentResponse: true
        )
    }

    options {
        timeout(time: 15, unit: 'MINUTES')
        timestamps()
        buildDiscarder(logRotator(numToKeepStr: '10'))
        disableConcurrentBuilds()
    }

    environment {
        // jenkins bot PAT (write:repository); needs Write collaborator on this repo to
        // create releases. usernamePassword: PersonalAccessTokenImpl implements it.
        GITEA_CREDS = 'a84cd7c3-afea-4071-9bdf-5305ee8d26ee'
        // AMO Developer Hub API key: username = JWT issuer, password = JWT secret.
        AMO_CREDS   = 'amo-api'
        SOURCE_ZIP  = 'web-ext-artifacts/source.zip'
    }

    stages {
        stage('Checkout') {
            steps {
                script {
                    def scmVars = checkout scm
                    env.COMMIT = scmVars.GIT_COMMIT
                    env.REPO_API = scmVars.GIT_URL
                        .replaceFirst(/\.git$/, '')
                        .replaceFirst(/^(https:\/\/[^\/]+)\//, '$1/api/v1/repos/')
                    env.VERSION = sh(
                        script: "node -p \"require('./src/manifest.json').version\"",
                        returnStdout: true
                    ).trim()
                }
            }
        }

        stage('Test') {
            steps {
                sh 'node --version && npm --version'  // the README promises reviewers these
                sh 'npm ci'
                sh 'npm test'
                sh 'npm run lint'
            }
        }

        stage('Released?') {
            steps {
                script {
                    withCredentials([usernamePassword(
                        credentialsId: env.GITEA_CREDS,
                        usernameVariable: 'G_USER',
                        passwordVariable: 'G_TOKEN'
                    )]) {
                        def code = sh(
                            script: '''curl -sS -o /dev/null -w '%{http_code}' --user "$G_USER:$G_TOKEN" "$REPO_API/releases/tags/v$VERSION"''',
                            returnStdout: true
                        ).trim()
                        if (code == '200') {
                            env.RELEASE = 'false'
                        } else if (code == '404') {
                            env.RELEASE = 'true'
                        } else {
                            error("Gitea answered HTTP ${code} for release v${env.VERSION}")
                        }
                    }
                }
            }
        }

        stage('Submit to AMO') {
            when { expression { env.RELEASE == 'true' } }
            steps {
                // Tracked files only: what a reviewer needs to rebuild dist/ byte for
                // byte (src, lockfile, README with the build steps) and nothing else.
                sh '''
                    rm -rf web-ext-artifacts && mkdir web-ext-artifacts
                    git archive --format=zip -o "$SOURCE_ZIP" HEAD
                '''
                withCredentials([usernamePassword(
                    credentialsId: env.AMO_CREDS,
                    usernameVariable: 'WEB_EXT_API_KEY',
                    passwordVariable: 'WEB_EXT_API_SECRET'
                )]) {
                    sh 'npm run sign'
                }
                archiveArtifacts artifacts: env.SOURCE_ZIP, fingerprint: true
            }
        }

        stage('Publish') {
            when { expression { env.RELEASE == 'true' } }
            steps {
                withCredentials([usernamePassword(
                    credentialsId: env.GITEA_CREDS,
                    usernameVariable: 'G_USER',
                    passwordVariable: 'G_TOKEN'
                )]) {
                    // If this fails after AMO accepted the version, the next build
                    // resubmits and AMO answers 409 — create the release by hand
                    // (tag v<version>) rather than bumping, the version is already live.
                    sh '''
                        set -eu
                        body="Submitted to addons.mozilla.org for review; Firefox installs and updates it from there."
                        id=$(curl -fsS --user "$G_USER:$G_TOKEN" -H 'Content-Type: application/json' \
                               -d "{\\"tag_name\\":\\"v$VERSION\\",\\"target_commitish\\":\\"$COMMIT\\",\\"name\\":\\"v$VERSION\\",\\"body\\":\\"$body\\"}" \
                               "$REPO_API/releases" \
                             | python3 -c 'import json,sys; print(json.load(sys.stdin)["id"])')
                        curl -fsS --user "$G_USER:$G_TOKEN" -F "attachment=@$SOURCE_ZIP" \
                          "$REPO_API/releases/$id/assets?name=bookmarks_mirror-$VERSION-source.zip" >/dev/null
                    '''
                }
            }
        }
    }

    post {
        success {
            echo env.RELEASE == 'true' ? "Submitted v${env.VERSION} to AMO"
                                       : "v${env.VERSION} already released — tested only"
        }
    }
}
