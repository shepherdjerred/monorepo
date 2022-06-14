document.addEventListener("DOMContentLoaded", function() {
    document.getElementById("navTitle").addEventListener("click", toggleNav);

    function toggleNav() {
        document.getElementById("navbar").classList.toggle("collapsed");
    }
});
