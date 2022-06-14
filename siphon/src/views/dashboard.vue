<template>
    <div class="pure-g dashboard-container">
        <div class="pure-u-1 dashboard">
            <h1 class="dashboard-title _center">Welcome to Siphon</h1>
            <p>
                The main purpose of this site is to provide an easier way to navigate through Harding's online resources.
                Use the sidebar to the left to find the pages you need, and they will open up in a new tab for you.
            </p>
            <h2>Contact</h2>
            <p>
                If you discover any issues with Siphon, contact <a href="mailto:jshepherd@harding.edu">jshepherd@harding.edu</a>
            </p>
            <h2>Disclaimer</h2>
            <p>
                Siphon is not an official resource from Harding University, and is not associated with the University in any way.
            </p>
        </div>
    </div>
</template>

<script>

</script>

<style lang="scss" scoped>
    .dashboard-container {
        background-color: #fff;
        width: 100%;
        min-height: 100vh;

        > .dashboard {
            padding: 30px 10% 0;

            > .dashboard-title {
                margin: 0;
                padding: 0;
            }
        }
    }
</style>
