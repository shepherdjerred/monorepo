<?php
namespace Storm\Forum\Cli\Command;
use Symfony\Component\Console\Input\InputInterface;
use Symfony\Component\Console\Output\OutputInterface;

final class Styles extends \XF\Cli\Command\AbstractCommand
{
    protected function configure(): void { $this->setName('storm:styles')->setDescription('Import private Flexile parents and owned Storm child styles.'); }

    protected function execute(InputInterface $input, OutputInterface $output): int
    {
        $app = \XF::app();
        require_once '/opt/storm-forum/runtime/style-archive.php';
        $manifest = json_decode(file_get_contents('/opt/storm-forum/config/forum.json'), true, 512, JSON_THROW_ON_ERROR);
        $dependencies = array_values(array_filter($manifest['vendorDependencies'], fn($dependency) => $dependency['kind'] === 'style'));
        if (count($dependencies) !== 2 || count(array_unique(array_column($dependencies, 'mode'))) !== 2) {
            throw new \RuntimeException('Exactly one light and dark Flexile parent is required');
        }
        // Validate both archives before importing either one.
        foreach ($dependencies as $dependency) { stormValidateStyleArchive('/app/forum/' . $dependency['path'], $dependency); }
        \Storm\Forum\Service\ThemeCatalog::load(true);
        $season = $app->registry()->get('stormForumSeason') ?: 'normal';
        \Storm\Forum\Service\ThemeCatalog::theme($season);
        $map = $app->registry()->get('stormForumStyles') ?: [];
        foreach ($dependencies as $dependency) {
            $mode = $dependency['mode'];
            $parentKey = 'flexile-parent:' . $mode;
            $file = '/app/forum/' . $dependency['path'];
            $archiveImporter = $app->service('XF:Style\ArchiveImport', $file);
            if (!$archiveImporter->validateArchive($errors)) { throw new \RuntimeException('Invalid vendor style archive'); }
            $document = \XF\Util\Xml::openFile($archiveImporter->getXmlFile());
            $importer = $app->service('XF:Style\Import');
            $importer->setArchiveImporter($archiveImporter);
            if (isset($map[$parentKey])) {
                $parent = $app->em()->find('XF:Style', $map[$parentKey]);
                if (!$parent) { throw new \RuntimeException('Managed Flexile parent is missing'); }
                $importer->setOverwriteStyle($parent);
            }
            if (!$importer->isValidXml($document, $error) || !$importer->isValidConfiguration($document, $errors)) {
                throw new \RuntimeException('Vendor style is incompatible with the installed XenForo/add-ons');
            }
            $parent = $importer->importFromXml($document);
            $parent->user_selectable = false;
            $parent->save();
            $map[$parentKey] = $parent->style_id;
            // Checkpoint each import so an interrupted release resumes with the same IDs.
            $app->registry()->set('stormForumStyles', $map);
            $app->service('XF:StyleProperty\Rebuild')->rebuildFullPropertyMap();
            $app->service('Storm\Forum:OwnedStyles')->apply($parent, $mode, $map);
        }
        $app->service('Storm\Forum:SeasonPolicy')->apply($season, (bool)$app->registry()->get('stormForumFollowCalendar'));
        $app->repository('XF:Style')->triggerStyleDataRebuild();
        $output->writeln('Private Flexile parents and owned Storm styles imported.');
        return 0;
    }
}
