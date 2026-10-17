// dbautz/bookmarks-mirror — test every push; sign and release on a version bump.
//
// The release trigger is the version in src/manifest.json having no Gitea release yet,
// not a tag or a parameter. AMO refuses to sign a version twice, so "one release per
// version" is a constraint we inherit anyway — this just makes the bump the button.
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
        timeout(time: 30, unit: 'MINUTES')  // web-ext sign waits up to 15 for AMO review
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

        stage('Sign') {
            when { expression { env.RELEASE == 'true' } }
            steps {
                withCredentials([usernamePassword(
                    credentialsId: env.AMO_CREDS,
                    usernameVariable: 'WEB_EXT_API_KEY',
                    passwordVariable: 'WEB_EXT_API_SECRET'
                )]) {
                    sh '''
                        rm -rf web-ext-artifacts
                        npm run sign
                        mv web-ext-artifacts/*-"$VERSION".xpi web-ext-artifacts/bookmarks_mirror-"$VERSION".xpi
                    '''
                }
                // Kept on the build too: once AMO has signed a version it will not sign
                // it again, so if the publish below fails this is the only copy.
                archiveArtifacts artifacts: 'web-ext-artifacts/*.xpi', fingerprint: true
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
                    // A release without its .xpi would read as "released" and every later
                    // build would skip it, so a failed upload deletes the release again.
                    sh '''
                        set -eu
                        xpi="web-ext-artifacts/bookmarks_mirror-$VERSION.xpi"
                        id=$(curl -fsS --user "$G_USER:$G_TOKEN" -H 'Content-Type: application/json' \
                               -d "{\\"tag_name\\":\\"v$VERSION\\",\\"target_commitish\\":\\"$COMMIT\\",\\"name\\":\\"v$VERSION\\"}" \
                               "$REPO_API/releases" \
                             | python3 -c 'import json,sys; print(json.load(sys.stdin)["id"])')
                        if ! curl -fsS --user "$G_USER:$G_TOKEN" -F "attachment=@$xpi" \
                               "$REPO_API/releases/$id/assets?name=$(basename "$xpi")" >/dev/null; then
                            curl -sS -X DELETE --user "$G_USER:$G_TOKEN" "$REPO_API/releases/$id"
                            echo "upload failed; release v$VERSION removed — xpi is on this build's artifacts" >&2
                            exit 1
                        fi
                    '''
                }
            }
        }
    }

    post {
        success {
            echo env.RELEASE == 'true' ? "Released v${env.VERSION}"
                                       : "v${env.VERSION} already released — tested only"
        }
    }
}
