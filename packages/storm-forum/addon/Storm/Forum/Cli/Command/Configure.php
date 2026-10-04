<?php
namespace Storm\Forum\Cli\Command;

use Symfony\Component\Console\Input\InputInterface;
use Symfony\Component\Console\Input\InputOption;
use Symfony\Component\Console\Output\OutputInterface;

final class Configure extends \XF\Cli\Command\AbstractCommand
{
    protected function configure(): void
    {
        $this->setName('storm:configure')->setDescription('Apply the owned forum configuration without replacing member data.')
            ->addOption('stage', null, InputOption::VALUE_REQUIRED, 'beta or prod');
    }

    protected function execute(InputInterface $input, OutputInterface $output): int
    {
        $manifest = json_decode(file_get_contents('/opt/storm-forum/config/forum.json'), true, 512, JSON_THROW_ON_ERROR);
        $stage = $input->getOption('stage');
        if (!isset($manifest['stages'][$stage]) || \XF::$version !== $manifest['xenforoVersion']) {
            throw new \RuntimeException('Stage or XenForo version does not match the release manifest.');
        }
        $db = \XF::db();
        if (!$db->fetchOne("SELECT GET_LOCK('storm_forum_config', 0)")) {
            throw new \RuntimeException('A forum configuration release is already running.');
        }
        try {
            $configurator = new \Storm\Forum\Service\Configuration(\XF::app());
            $configurator->apply($manifest, $stage);
        } finally {
            $db->fetchOne("SELECT RELEASE_LOCK('storm_forum_config')");
        }
        $output->writeln('Storm configuration applied.');
        return 0;
    }
}
