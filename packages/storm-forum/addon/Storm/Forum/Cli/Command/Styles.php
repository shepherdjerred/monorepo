<?php
namespace Storm\Forum\Cli\Command;
use Symfony\Component\Console\Input\InputInterface;
use Symfony\Component\Console\Output\OutputInterface;

final class Styles extends \XF\Cli\Command\AbstractCommand
{
    protected function configure(): void { $this->setName('storm:styles')->setDescription('Import licensed parents and independently authored Storm child styles.'); }

    protected function execute(InputInterface $input, OutputInterface $output): int
    {
        $app = \XF::app();
        $map = $app->registry()->get('stormForumStyles') ?: [];
        foreach (['light' => 'uix-classic.zip', 'dark' => 'uix-classic-dark.zip'] as $mode => $archive) {
            $file = '/app/forum/vendor/' . $archive;
            $archiveImporter = $app->service('XF:Style\ArchiveImport', $file);
            if (!$archiveImporter->validateArchive($errors)) { throw new \RuntimeException('Invalid vendor style archive'); }
            $document = \XF\Util\Xml::openFile($archiveImporter->getXmlFile());
            $importer = $app->service('XF:Style\Import');
            $importer->setArchiveImporter($archiveImporter);
            if (!$importer->isValidXml($document, $error) || !$importer->isValidConfiguration($document, $errors)) {
                throw new \RuntimeException('Vendor style is incompatible with the installed XenForo/add-ons');
            }
            if (isset($map['parent:' . $mode])) {
                $parent = $app->em()->find('XF:Style', $map['parent:' . $mode]);
                if (!$parent) { throw new \RuntimeException('Managed vendor style missing'); }
                $importer->setOverwriteStyle($parent);
            }
            $parent = $importer->importFromXml($document);
            $parent->user_selectable = false;
            $parent->save();
            $map['parent:' . $mode] = $parent->style_id;
            // Checkpoint each import so an interrupted release resumes with the same IDs.
            $app->registry()->set('stormForumStyles', $map);
            $app->service('Storm\Forum:OwnedStyles')->apply($parent, $mode, $map);
        }
        $app->repository('XF:Option')->updateOption('defaultStyleId', $map['light:normal']);
        $app->repository('XF:Style')->triggerStyleDataRebuild();
        $output->writeln('Licensed parents and owned Storm styles imported.');
        return 0;
    }
}
